import asyncio
import os
import tempfile
import uuid
from datetime import datetime

from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .models import HighlightAnnotation, NoteAnnotation
from .schemas import (
    BookSummaryResponse,
    BookDetailResponse,
    StateUpdateRequest,
    HighlightCreateRequest,
    NoteCreateRequest,
)
from .store import store, BOOKS_DIR, ANNOTATIONS_DIR
from .epub import ingest_epub
from .summarize import run_summarize, task_error_handler, N_THRESHOLD, PARTIAL_INTERVAL

load_dotenv()

import logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)

app = FastAPI(title="Bibliophile", version="0.1.0")

cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in cors_origins],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _now() -> str:
    return datetime.utcnow().isoformat() + "Z"


# --- Book routes ---


@app.post("/books/upload", response_model=BookSummaryResponse)
async def upload_book(file: UploadFile = File(...)):
    suffix = ".epub"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        book = await ingest_epub(tmp_path, file.filename or "unknown.epub")
    finally:
        os.unlink(tmp_path)

    count = 0  # freshly uploaded, no annotations yet
    return BookSummaryResponse(
        id=book.id,
        title=book.title,
        author=book.author,
        cover_base64=book.cover_base64,
        current_chapter_index=book.current_chapter_index,
        semantic_paragraph_index=book.semantic_paragraph_index,
        chapter_count=len(book.chapters),
        annotation_count=count,
    )


@app.get("/books", response_model=list[BookSummaryResponse])
async def list_books():
    return await store.list_books()


@app.get("/books/{book_id}", response_model=BookDetailResponse)
async def get_book(book_id: str):
    return await store.get_book_detail(book_id)


@app.delete("/books/{book_id}", status_code=204)
async def delete_book(book_id: str):
    await store.get_book(book_id)  # 404 if not found
    (BOOKS_DIR / f"{book_id}.json").unlink(missing_ok=True)
    (BOOKS_DIR / f"{book_id}.epub").unlink(missing_ok=True)
    ann_dir = ANNOTATIONS_DIR / book_id
    if ann_dir.exists():
        import shutil as _shutil
        _shutil.rmtree(ann_dir)


@app.put("/books/{book_id}/state", status_code=204)
async def update_state(book_id: str, req: StateUpdateRequest):
    book = await store.get_book(book_id)
    old_chapter = book.current_chapter_index
    new_chapter = req.current_chapter_index
    new_para = req.semantic_paragraph_index

    book.current_chapter_index = new_chapter
    book.semantic_paragraph_index = new_para
    await store.save_book(book)

    if new_chapter > old_chapter:
        # Reader advanced to a new chapter — finalize summary of departed chapter
        t = asyncio.create_task(
            run_summarize(book_id, old_chapter, is_complete=True),
            name=f"summarize/{book_id}/ch{old_chapter}/complete",
        )
        t.add_done_callback(task_error_handler)
    elif new_chapter == old_chapter and book.chapters:
        ch = book.chapters[new_chapter]
        if new_para >= N_THRESHOLD:
            last = ch.summarized_to_paragraph or 0
            if new_para - last >= PARTIAL_INTERVAL:
                t = asyncio.create_task(
                    run_summarize(
                        book_id, new_chapter, is_complete=False, up_to_paragraph=new_para
                    ),
                    name=f"summarize/{book_id}/ch{new_chapter}/partial@{new_para}",
                )
                t.add_done_callback(task_error_handler)


@app.post("/books/{book_id}/chapters/{chapter_index}/summarize", status_code=202)
async def summarize_chapter(book_id: str, chapter_index: int):
    book = await store.get_book(book_id)
    if chapter_index < 0 or chapter_index >= len(book.chapters):
        return JSONResponse(status_code=404, content={"detail": "Chapter not found"})
    t = asyncio.create_task(
        run_summarize(book_id, chapter_index, is_complete=True),
        name=f"summarize/{book_id}/ch{chapter_index}/manual",
    )
    t.add_done_callback(task_error_handler)
    return JSONResponse(status_code=202, content={"status": "accepted"})


# --- Annotation routes ---


@app.get("/books/{book_id}/annotations")
async def list_annotations(book_id: str):
    annotations = await store.load_annotations(book_id)
    return [a.model_dump() for a in annotations]


@app.post("/books/{book_id}/annotations/highlight", response_model=None)
async def create_highlight(book_id: str, req: HighlightCreateRequest):
    # Verify book exists
    await store.get_book(book_id)

    ann = HighlightAnnotation(
        id=f"highlight/{uuid.uuid4()}",
        book_id=book_id,
        chapter_id=req.chapter_id,
        chapter_index=req.chapter_index,
        paragraph_index=req.paragraph_index,
        created_at=_now(),
        type="highlight",
        selected_text=req.selected_text,
        content=req.content,
        start_offset=req.start_offset,
        end_offset=req.end_offset,
    )
    await store.save_annotation(book_id, ann)
    return ann.model_dump()


@app.post("/books/{book_id}/annotations/note", response_model=None)
async def create_note(book_id: str, req: NoteCreateRequest):
    await store.get_book(book_id)

    ann = NoteAnnotation(
        id=f"note/{uuid.uuid4()}",
        book_id=book_id,
        chapter_id=req.chapter_id,
        chapter_index=req.chapter_index,
        paragraph_index=req.paragraph_index,
        created_at=_now(),
        type="note",
        content=req.content,
    )
    await store.save_annotation(book_id, ann)
    return ann.model_dump()


@app.delete("/books/{book_id}/annotations/{ann_id:path}", status_code=204)
async def delete_annotation(book_id: str, ann_id: str):
    await store.delete_annotation(book_id, ann_id)
