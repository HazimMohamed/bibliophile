#!/usr/bin/env python3
"""
test_summarize.py — manually trigger summarization for a chapter.

Usage:
    python -m scripts.test_summarize <book_id> <chapter_index> [--partial [up_to_para]]

Examples:
    python -m scripts.test_summarize abc123 0
    python -m scripts.test_summarize abc123 0 --partial 30
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.store import store
from backend.summarize import run_summarize


async def main() -> None:
    args = sys.argv[1:]
    if len(args) < 2:
        print(__doc__)
        sys.exit(1)

    book_id = args[0]
    chapter_index = int(args[1])
    is_complete = True
    up_to_paragraph = None

    if "--partial" in args:
        is_complete = False
        idx = args.index("--partial")
        if idx + 1 < len(args):
            try:
                up_to_paragraph = int(args[idx + 1])
            except ValueError:
                pass

    book = await store.get_book(book_id)
    ch = book.chapters[chapter_index]
    total = len(ch.paragraphs)
    mode = "complete" if is_complete else f"partial up to ¶{up_to_paragraph}"
    print(f"Book : {book.title!r}")
    print(f"Chapter [{chapter_index}]: {ch.title!r} ({total} paragraphs)")
    print(f"Mode : {mode}")
    print("Running summarization…")

    await run_summarize(book_id, chapter_index, is_complete, up_to_paragraph)

    book = await store.get_book(book_id)
    summary = book.chapters[chapter_index].summary
    print(f"\n--- Summary ---\n{summary}\n")


if __name__ == "__main__":
    asyncio.run(main())
