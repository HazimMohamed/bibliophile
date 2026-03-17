import asyncio
import logging
import os
import time
from datetime import datetime

import anthropic
from dotenv import load_dotenv

from .store import store

log = logging.getLogger("bibliophile.summarize")

load_dotenv()

# In-flight guard: set of (book_id, chapter_index) currently being summarized.
# Prevents duplicate background tasks from piling up.
_in_flight: set[tuple[str, int]] = set()

_HAIKU_MODEL = os.getenv("HAIKU_MODEL", "claude-haiku-4-5-20251001")

_SYSTEM_PROMPT = """\
You are an AI reader summarizing your own memory of what you just read.
Write as a reader who has experienced only the text provided — nothing more.
You have no knowledge of this book outside what appears in your context.

Your summary is your memory. Write what you learned, felt, and noticed
as you read. Future conversations will rely on this memory to understand
the story so far, so be faithful and complete.

Capture:
- Every named character you encountered, what they were like, what they did
- What happened and in what order
- The mood and atmosphere of the chapter as you experienced it
- Details that lodged in your mind — objects, places, tensions,
  unresolved questions
- Anything that felt like it might matter later, without knowing why

You may note uncertainty: "a character is mentioned briefly whose
significance is unclear." That is honest memory.

Do not reference anything outside the provided text. Do not draw on
knowledge of this book, its author, or its themes from outside what
you have read. If you recognize a theme or pattern, you recognized it
from the text in front of you, not from prior knowledge.

Previous summaries represent your memory of earlier chapters.
Use them for continuity — to recognize returning characters and
developing threads — not to repeat what you already remember.\
"""


def _instruction(chapter_index: int, title: str, is_complete: bool) -> str:
    n = chapter_index + 1
    if is_complete:
        return f'Summarize chapter {n}: "{title}". This is a complete chapter.'
    return (
        f'Summarize chapter {n}: "{title}" up to the current reading position.\n'
        "This chapter is not yet complete — do not write as though it has ended."
    )


async def run_summarize(
    book_id: str,
    chapter_index: int,
    is_complete: bool,
    up_to_paragraph: int | None = None,
) -> None:
    key = (book_id, chapter_index)
    if key in _in_flight:
        log.debug("summarize skip  book=%s chapter=%d (already in-flight)", book_id, chapter_index)
        return
    _in_flight.add(key)
    try:
        await _do_summarize(book_id, chapter_index, is_complete, up_to_paragraph)
    finally:
        _in_flight.discard(key)


def task_error_handler(task: asyncio.Task) -> None:
    """Done callback for summarize tasks — logs unhandled exceptions."""
    if task.cancelled():
        return
    exc = task.exception()
    if exc is not None:
        log.exception("summarize task failed: %s", task.get_name(), exc_info=exc)


async def _do_summarize(
    book_id: str,
    chapter_index: int,
    is_complete: bool,
    up_to_paragraph: int | None = None,
) -> None:
    book = await store.get_book(book_id)
    ch = book.chapters[chapter_index]
    mode = "complete" if is_complete else f"partial up_to={up_to_paragraph}"
    log.info(
        "summarize start book=%s chapter=%d (%r) mode=%s paragraphs=%d",
        book_id, chapter_index, ch.title, mode, len(ch.paragraphs),
    )
    t0 = time.monotonic()

    # Previous chapter summaries as memory context
    prev_summaries = [
        f"## Chapter {i + 1}: {book.chapters[i].title}\n\n{book.chapters[i].summary}"
        for i in range(chapter_index)
        if book.chapters[i].summary
    ]

    # Chapter text — full or up to reading position
    paragraphs = ch.paragraphs
    if not is_complete and up_to_paragraph is not None:
        paragraphs = paragraphs[: up_to_paragraph + 1]
    chapter_text = "\n\n".join(paragraphs)

    # Build single user message
    parts: list[str] = []
    if prev_summaries:
        parts.append(
            "Your memory of previously read chapters:\n\n"
            + "\n\n---\n\n".join(prev_summaries)
        )
        parts.append("---")
    parts.append(f"Chapter text:\n\n{chapter_text}")
    parts.append(_instruction(chapter_index, ch.title, is_complete))
    user_content = "\n\n".join(parts)

    client = anthropic.AsyncAnthropic()
    response = await client.messages.create(
        model=_HAIKU_MODEL,
        max_tokens=1024,
        system=_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_content}],
    )
    summary = response.content[0].text

    elapsed = time.monotonic() - t0
    log.info(
        "summarize done  book=%s chapter=%d (%r) words=%d elapsed=%.1fs",
        book_id, chapter_index, ch.title, len(summary.split()), elapsed,
    )

    # Write summary back into the chapter
    now = datetime.utcnow().isoformat() + "Z"
    # Re-fetch to avoid overwriting concurrent state changes
    book = await store.get_book(book_id)
    book.chapters[chapter_index].summary = summary
    book.chapters[chapter_index].summarized_at = now
    await store.save_book(book)
