import os

N_VERBATIM = int(os.getenv("N_VERBATIM_PARAGRAPHS", "15"))
SONNET_MODEL = os.getenv("SONNET_MODEL", "claude-sonnet-4-6")


def assemble_context(book, conversation, is_opening=False):
    ch_idx = conversation.start.chapter_index
    para_idx = conversation.start.paragraph_index
    ch = book.chapters[ch_idx]

    prev_summaries = [
        f"## Chapter {i+1}: {book.chapters[i].title}\n\n{book.chapters[i].summary}"
        for i in range(ch_idx)
        if book.chapters[i].summary
    ]

    start = max(0, para_idx - N_VERBATIM)
    end = min(len(ch.paragraphs), para_idx + N_VERBATIM + 1)
    verbatim = "\n\n".join(ch.paragraphs[start:end])

    parts = []
    if prev_summaries:
        parts.append("Your memory of previously read chapters:\n\n" + "\n\n---\n\n".join(prev_summaries))
    parts.append(f"Current chapter text around reading position:\n\n{verbatim}")
    if conversation.selected_text:
        parts.append(
            f'Selected passage (what the reader highlighted):\n\n"{conversation.selected_text}"\n'
            f'Highlighted at chapter {ch_idx+1}, paragraph {para_idx}.'
        )
    context_block = "\n\n---\n\n".join(parts)

    total = len(book.chapters)
    system = (
        f'You are a reading companion for "{book.title}" by {book.author}.\n\n'
        "You are a reader, not a tutor. You have read this book up to exactly the point "
        "described in your context — no further. You do not know what happens next.\n\n"
        "Engage as a thoughtful fellow reader: have opinions, notice things, be curious. "
        "Speculate freely. Match the reader's register. Don't over-explain.\n\n"
        f"The reader is at chapter {ch_idx+1} of {total}."
    )

    if is_opening:
        system += (
            "\n\nYou have just been invited into a conversation. React to this moment as a fellow reader "
            "— with immediacy and curiosity. Notice something specific. Ask something genuine. Be brief. "
            "Do not introduce yourself. Just begin."
        )

    messages = [{"role": "user", "content": context_block}]
    if conversation.messages:
        messages += [{"role": m.role, "content": m.content} for m in conversation.messages]

    return system, messages
