#!/usr/bin/env python3
"""
reset_summaries.py — clear all chapter summaries for one or all books.

Usage:
    python -m scripts.reset_summaries               # all books
    python -m scripts.reset_summaries <book_id>     # one book
"""
import asyncio
import sys
from pathlib import Path

# Allow running from the repo root
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.store import store, BOOKS_DIR


async def reset(book_id: str | None = None) -> None:
    if book_id:
        book_ids = [book_id]
    else:
        book_ids = [f.stem for f in BOOKS_DIR.glob("*.json")]

    for bid in book_ids:
        try:
            book = await store.get_book(bid)
        except Exception as e:
            print(f"  skip {bid}: {e}")
            continue

        cleared = 0
        for ch in book.chapters:
            if ch.summary is not None:
                ch.summary = None
                ch.summarized_at = None
                cleared += 1

        await store.save_book(book)
        print(f"  {book.title!r} ({bid}): cleared {cleared} summaries")


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else None
    asyncio.run(reset(target))
