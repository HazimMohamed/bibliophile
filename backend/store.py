import asyncio
import json
import os
from pathlib import Path

import aiofiles
from dotenv import load_dotenv
from fastapi import HTTPException
from pydantic import TypeAdapter

from .models import Annotation, Book
from .schemas import (
    BookDetailResponse,
    BookSummaryResponse,
    ChapterFullResponse,
)

load_dotenv()

BOOKS_DIR = Path(os.getenv("BOOKS_DIR", "./data/books"))
ANNOTATIONS_DIR = Path(os.getenv("ANNOTATIONS_DIR", "./data/annotations"))

_annotation_adapter = TypeAdapter(Annotation)


def _ensure_dirs() -> None:
    BOOKS_DIR.mkdir(parents=True, exist_ok=True)
    ANNOTATIONS_DIR.mkdir(parents=True, exist_ok=True)


_ensure_dirs()


def _book_path(book_id: str) -> Path:
    return BOOKS_DIR / f"{book_id}.json"


def _ann_dir(book_id: str) -> Path:
    return ANNOTATIONS_DIR / book_id


def _ann_path(book_id: str, ann_id: str) -> Path:
    safe_id = ann_id.replace("/", "_")
    return _ann_dir(book_id) / f"{safe_id}.json"


def _annotation_count(book_id: str) -> int:
    d = _ann_dir(book_id)
    if not d.exists():
        return 0
    return sum(1 for f in d.iterdir() if f.suffix == ".json")


def _book_to_summary(book: Book, annotation_count: int) -> BookSummaryResponse:
    return BookSummaryResponse(
        id=book.id,
        title=book.title,
        author=book.author,
        cover_base64=book.cover_base64,
        current_chapter_index=book.current_chapter_index,
        semantic_paragraph_index=book.semantic_paragraph_index,
        chapter_count=len(book.chapters),
        annotation_count=annotation_count,
    )


def _chapter_to_response(ch) -> ChapterFullResponse:
    return ChapterFullResponse(
        id=ch.id,
        index=ch.index,
        title=ch.title,
        part=ch.part,
        paragraphs=ch.paragraphs,
        paragraph_count=len(ch.paragraphs),
        is_summarized=ch.summary is not None,
        summary=ch.summary,
    )


class JSONStore:
    async def list_books(self) -> list[BookSummaryResponse]:
        results: list[BookSummaryResponse] = []
        if not BOOKS_DIR.exists():
            return results
        json_files = [f for f in BOOKS_DIR.iterdir() if f.suffix == ".json"]
        for f in json_files:
            async with aiofiles.open(f, "r") as fh:
                data = await fh.read()
            book = Book.model_validate_json(data)
            count = _annotation_count(book.id)
            results.append(_book_to_summary(book, count))
        return results

    async def get_book(self, book_id: str) -> Book:
        p = _book_path(book_id)
        if not p.exists():
            raise HTTPException(status_code=404, detail="Book not found")
        async with aiofiles.open(p, "r") as fh:
            data = await fh.read()
        return Book.model_validate_json(data)

    async def get_book_detail(self, book_id: str) -> BookDetailResponse:
        book = await self.get_book(book_id)
        count = _annotation_count(book_id)
        summary = _book_to_summary(book, count)
        chapters = [_chapter_to_response(ch) for ch in book.chapters]
        return BookDetailResponse(**summary.model_dump(), chapters=chapters)

    async def save_book(self, book: Book) -> None:
        _ensure_dirs()
        p = _book_path(book.id)
        async with aiofiles.open(p, "w") as fh:
            await fh.write(book.model_dump_json(indent=2))

    async def load_annotations(self, book_id: str) -> list[Annotation]:
        d = _ann_dir(book_id)
        if not d.exists():
            return []
        json_files = [f for f in d.iterdir() if f.suffix == ".json"]
        if not json_files:
            return []

        async def _read_one(path: Path) -> Annotation:
            async with aiofiles.open(path, "r") as fh:
                data = await fh.read()
            return _annotation_adapter.validate_json(data)

        results = await asyncio.gather(*[_read_one(f) for f in json_files])
        return list(results)

    async def save_annotation(self, book_id: str, annotation: Annotation) -> None:
        d = _ann_dir(book_id)
        d.mkdir(parents=True, exist_ok=True)
        p = _ann_path(book_id, annotation.id)
        async with aiofiles.open(p, "w") as fh:
            await fh.write(annotation.model_dump_json(indent=2))

    async def delete_annotation(self, book_id: str, ann_id: str) -> None:
        p = _ann_path(book_id, ann_id)
        if not p.exists():
            raise HTTPException(status_code=404, detail="Annotation not found")
        p.unlink()

    async def get_annotation(self, book_id: str, ann_id: str) -> Annotation:
        p = _ann_path(book_id, ann_id)
        if not p.exists():
            raise HTTPException(status_code=404, detail="Annotation not found")
        async with aiofiles.open(p, "r") as fh:
            data = await fh.read()
        return _annotation_adapter.validate_json(data)


store = JSONStore()
