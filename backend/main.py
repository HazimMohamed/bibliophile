import asyncio
import os
import tempfile
import uuid
from datetime import datetime, timedelta
from html import escape

from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, HTMLResponse
import httpx

from .models import HighlightAnnotation, NoteAnnotation, TextIndex
from .schemas import (
    BookSummaryResponse,
    BookDetailResponse,
    StateUpdateRequest,
    HighlightCreateRequest,
    NoteCreateRequest,
)
from .store import store, BOOKS_DIR, ANNOTATIONS_DIR
from .covers import default_cover_service
from .epub import ingest_epub
from .summarize import run_summarize, task_error_handler
from .chat import router as chat_router

load_dotenv()

import logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)

app = FastAPI(title="Bibliophile", version="0.1.0")
app.include_router(chat_router)

cors_origins = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:5173,http://localhost,https://localhost,capacitor://localhost",
).split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in cors_origins],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _now() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _fmt_int(n: int) -> str:
    return f"{n:,}"


async def _fetch_usage_tokens_last_24h():
    """
    Pull org-level token usage from Anthropic Usage API.
    Requires ANTHROPIC_ADMIN_API_KEY (regular API keys don't work for this).
    """
    admin_key = os.getenv("ANTHROPIC_ADMIN_API_KEY", "").strip()
    if not admin_key:
        return None, "Set ANTHROPIC_ADMIN_API_KEY to show org usage."

    end_at = datetime.utcnow().replace(microsecond=0)
    start_at = end_at - timedelta(days=1)
    params = {
        "starting_at": start_at.isoformat() + "Z",
        "ending_at": end_at.isoformat() + "Z",
        "bucket_width": "1d",
    }
    headers = {
        "x-api-key": admin_key,
        "anthropic-version": "2023-06-01",
    }

    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            resp = await client.get(
                "https://api.anthropic.com/v1/organizations/usage_report/messages",
                params=params,
                headers=headers,
            )
    except Exception as e:
        return None, f"Usage API unreachable: {e}"

    if resp.status_code != 200:
        detail = resp.text[:180].strip().replace("\n", " ")
        return None, f"Usage API error {resp.status_code}: {detail}"

    payload = resp.json()
    totals = {
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_creation_input_tokens": 0,
        "cache_read_input_tokens": 0,
    }
    found = False

    for bucket in payload.get("data", []):
        for result in bucket.get("results", []):
            for k in totals:
                v = result.get(k)
                if isinstance(v, (int, float)):
                    totals[k] += int(v)
                    found = True

    if not found:
        return None, "No usage data returned for the last 24h."
    return totals, None


# --- Status / dashboard ---

@app.get("/", response_class=HTMLResponse)
@app.get("/status", response_class=HTMLResponse)
async def status_dashboard():
    storage_ok = True
    storage_err = ""
    try:
        books = await store.list_books()
    except Exception as e:
        books = []
        storage_ok = False
        storage_err = str(e)

    book_count = len(books)
    chapter_count = sum(b.chapter_count for b in books) if storage_ok else 0
    annotation_count = sum(b.annotation_count for b in books) if storage_ok else 0
    cors_text = ", ".join([o.strip() for o in cors_origins if o.strip()])
    usage_totals, usage_error = await _fetch_usage_tokens_last_24h()

    if storage_ok and not usage_error:
        health_label = "Healthy"
        health_class = "ok"
    elif storage_ok:
        health_label = "Degraded"
        health_class = "warn"
    else:
        health_label = "Down"
        health_class = "bad"

    usage_summary = "Unavailable"
    usage_details = escape(usage_error or "Unavailable")
    if usage_totals:
        input_tokens = int(usage_totals["input_tokens"])
        output_tokens = int(usage_totals["output_tokens"])
        cache_creation = int(usage_totals["cache_creation_input_tokens"])
        cache_read = int(usage_totals["cache_read_input_tokens"])
        total_tokens = input_tokens + output_tokens + cache_creation + cache_read
        usage_summary = _fmt_int(total_tokens)
        usage_details = (
            f"in: {_fmt_int(input_tokens)} · out: {_fmt_int(output_tokens)} · "
            f"cache write: {_fmt_int(cache_creation)} · cache read: {_fmt_int(cache_read)}"
        )

    html = f"""
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Bibliophile Backend</title>
    <style>
      :root {{
        --bg: #f8f3ea;
        --surface: #ece3d2;
        --text: #1c1712;
        --muted: #8f8577;
        --accent: #d97757;
        --border: rgba(40, 30, 20, 0.15);
        --ok: #4f8a4c;
        --warn: #c07b2b;
        --bad: #b23a34;
      }}
      body {{
        margin: 0;
        background: radial-gradient(circle at top right, #efe4d0, var(--bg) 42%);
        color: var(--text);
        font-family: ui-serif, Georgia, "Times New Roman", serif;
      }}
      .wrap {{
        max-width: 860px;
        margin: 40px auto;
        padding: 0 18px;
      }}
      .card {{
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 12px;
        box-shadow: 0 8px 24px rgba(50, 38, 26, 0.14);
        padding: 18px;
      }}
      .title {{
        margin: 0 0 8px;
        font-size: 1.7rem;
      }}
      .subtitle {{
        margin: 0 0 18px;
        color: var(--muted);
        font-size: 0.95rem;
      }}
      .grid {{
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 10px;
        margin-bottom: 14px;
      }}
      .stat {{
        background: rgba(255, 255, 255, 0.35);
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 10px 12px;
      }}
      .k {{
        font-size: 0.75rem;
        color: var(--muted);
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }}
      .v {{
        margin-top: 3px;
        font-size: 1.1rem;
        font-weight: 700;
      }}
      code {{
        background: rgba(255, 255, 255, 0.42);
        border: 1px solid var(--border);
        border-radius: 6px;
        padding: 2px 6px;
      }}
      .foot {{
        margin-top: 12px;
        color: var(--muted);
        font-size: 0.85rem;
      }}
      .spark {{
        color: var(--accent);
      }}
      .health {{
        display: inline-flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 12px;
        font-weight: 600;
      }}
      .light {{
        width: 10px;
        height: 10px;
        border-radius: 999px;
        box-shadow: 0 0 0 2px rgba(255,255,255,0.45);
      }}
      .light.ok {{ background: var(--ok); }}
      .light.warn {{ background: var(--warn); }}
      .light.bad {{ background: var(--bad); }}
      .subv {{
        margin-top: 6px;
        color: var(--muted);
        font-size: 0.82rem;
        line-height: 1.35;
      }}
    </style>
  </head>
  <body>
    <main class="wrap">
      <section class="card">
        <h1 class="title">Bibliophile backend <span class="spark">✦</span></h1>
        <p class="subtitle">Quietly reading with you. API is online.</p>
        <div class="health"><span class="light {health_class}"></span>{health_label}</div>
        <div class="grid">
          <div class="stat"><div class="k">Books</div><div class="v">{book_count}</div></div>
          <div class="stat"><div class="k">Chapters</div><div class="v">{chapter_count}</div></div>
          <div class="stat"><div class="k">Annotations</div><div class="v">{annotation_count}</div></div>
          <div class="stat"><div class="k">Time (UTC)</div><div class="v">{escape(_now())}</div></div>
        </div>
        <div class="grid">
          <div class="stat">
            <div class="k">Anthropic Tokens (24h)</div>
            <div class="v">{escape(usage_summary)}</div>
            <div class="subv">{escape(usage_details)}</div>
          </div>
        </div>
        <div class="grid">
          <div class="stat"><div class="k">Sonnet Model</div><div class="v"><code>{escape(os.getenv("SONNET_MODEL", "claude-sonnet-4-6"))}</code></div></div>
          <div class="stat"><div class="k">Haiku Model</div><div class="v"><code>{escape(os.getenv("HAIKU_MODEL", "claude-haiku-4-5-20251001"))}</code></div></div>
        </div>
        <p><strong>Storage check:</strong> <code>{"ok" if storage_ok else "error: " + escape(storage_err)}</code></p>
        <p><strong>Books dir:</strong> <code>{escape(str(BOOKS_DIR))}</code></p>
        <p><strong>Annotations dir:</strong> <code>{escape(str(ANNOTATIONS_DIR))}</code></p>
        <p><strong>CORS:</strong> <code>{escape(cors_text or "(none)")}</code></p>
        <p class="foot">Tip: API docs at <code>/docs</code></p>
      </section>
    </main>
  </body>
</html>
"""
    return HTMLResponse(content=html)


@app.get("/healthz")
async def healthz():
    try:
        await store.list_books()
        storage = "ok"
    except Exception as e:
        return JSONResponse(
            status_code=503,
            content={"status": "degraded", "storage": "error", "error": str(e), "time": _now()},
        )
    return {"status": "ok", "storage": storage, "time": _now()}


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
        reading_position=book.reading_position,
        chapter_count=len(book.chapters),
        annotation_count=count,
    )


@app.get("/books", response_model=list[BookSummaryResponse])
async def list_books():
    return await store.list_books()


@app.get("/books/{book_id}", response_model=BookDetailResponse)
async def get_book(book_id: str):
    return await store.get_book_detail(book_id)


@app.post("/books/{book_id}/cover/regenerate")
async def regenerate_cover(book_id: str, generator: str = "svg"):
    book = await store.get_book(book_id)
    cover = await default_cover_service.generate(book.title, book.author)
    book.cover_base64 = cover
    book.cover_source = generator
    await store.save_book(book)
    return {"cover_base64": cover, "cover_source": generator}


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
    old_chapter = book.reading_position.chapter_index
    new_chapter = req.reading_position.chapter_index

    book.reading_position = req.reading_position
    await store.save_book(book)

    if new_chapter > old_chapter:
        # Reader advanced to a new chapter — finalize summary of departed chapter
        t = asyncio.create_task(
            run_summarize(book_id, old_chapter, is_complete=True),
            name=f"summarize/{book_id}/ch{old_chapter}/complete",
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
    await store.get_book(book_id)

    ann = HighlightAnnotation(
        id=f"highlight/{uuid.uuid4()}",
        book_id=book_id,
        chapter_id=req.chapter_id,
        position=req.start,
        created_at=_now(),
        type="highlight",
        start=req.start,
        end=req.end,
        selected_text=req.selected_text,
        content=req.content,
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
        position=req.start,
        created_at=_now(),
        type="note",
        start=req.start,
        end=req.end,
        selected_text=req.selected_text,
        content=req.content,
    )
    await store.save_annotation(book_id, ann)
    return ann.model_dump()


@app.delete("/books/{book_id}/annotations/{ann_id:path}", status_code=204)
async def delete_annotation(book_id: str, ann_id: str):
    await store.delete_annotation(book_id, ann_id)
