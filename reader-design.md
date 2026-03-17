# Bibliophile — AI Reading Companion
## Design Document
### Version: 0.0.11
### Status: Pre-release design draft

---

## Vision

A personal EPUB reader with a position-aware AI companion. The AI knows exactly where you are in a book, has its own memory of everything you've both read, and the verbatim text around your current position in context. It reads with you in naive mode — hermetically sealed to what's in context — bringing literary intelligence without plot knowledge beyond your current position.

The reader is a fully functional e-reader first. The AI is a layer on top.

---

## Philosophy

Most AI reading tools treat the model as a reference — a smarter search engine you can query about a text. That's not what this is.

Bibliophile is built around a different premise: that reading is more fun with a companion, and that the best companion is one who is discovering the book alongside you. The AI doesn't sit above the text with privileged knowledge. It reads with you, remembers what you've both seen, and brings its own curiosity, instincts, and uncertainty to the conversation.

The experience this is designed for: you're twenty pages into a chapter of The Idiot, something just happened that feels significant, and you want to turn to someone and say *did you feel that?* The companion was there for it. It noticed things too. It has opinions about where this might be going, and it might be wrong, and that's part of the pleasure.

This is a book club of two — one human, one AI — walking through a great work together for the first time. The naivety is not a limitation. It's the point.

---

## Core Principles

- **Position is ground truth.** The app always knows where you are. This predates and underlies everything else.
- **Context is assembled, not retrieved.** The AI receives a deterministically constructed context window: the AI's own memory of past chapters (summaries) + verbatim text around current position.
- **Naivety enforced at every layer.** Both the summarization model (Haiku) and the chat model (Sonnet) are constrained to reason only from what's in their context. The memory layer is as naive as the conversation layer.
- **Reader first.** Every AI feature should degrade gracefully. The app is useful without internet.
- **Storage and API are separate concerns.** Storage models define what goes to disk. Response models define what the API returns. Request models define what the API accepts. `store.py` owns the projection between them.

---

## Stack

| Layer | Choice | Reason |
|---|---|---|
| Backend | Python + FastAPI | Clean async, easy to self-host |
| EPUB parsing | `ebooklib` | Solid chapter extraction, metadata |
| Storage | Pydantic + flat JSON files | Zero ops, human-readable, self-migrating via defaults |
| Frontend | React + Vite | Component model suits three-screen layout |
| AI | Anthropic API | Haiku for summarization, Sonnet for chat |
| Deployment | VPS or local → Capacitor for mobile later | Self-hosted, no accounts |

---

## Data Model

### Storage models (`models.py`)

What gets written to disk. Never returned directly from API endpoints.

Each annotation is its own file — `annotations/{book_id}/{ann_id}.json`. The Book JSON is a pure index of metadata and reading state; it never embeds annotation content.

```python
from pydantic import BaseModel
from typing import Annotated, Literal
from pydantic import Field

# ── Position ─────────────────────────────────────────────────────────────────

class TextIndex(BaseModel):
    """A content-anchored position within a book.
    Survives layout changes, font resizes, and viewport differences.
    Supports natural ordering: (chapter_index, paragraph_index, offset)."""
    chapter_index: int
    paragraph_index: int
    offset: int                           # character offset within the paragraph text

# ── Chapters ────────────────────────────────────────────────────────────────

class Chapter(BaseModel):
    id: str                               # uuid4 — stable, collision-free
                                          # format: "chapter/{uuid4}"
    index: int                            # display order; set at ingest, stored explicitly
    title: str
    paragraphs: list[str]                 # plain text paragraphs, HTML stripped, whitespace normalized
                                          # paragraphs are structural units for context assembly,
                                          # not a position primitive — position uses TextIndex
    summary: str | None = None            # written on chapter advance or lazily at conversation open
    summarized_at: str | None = None

# ── Messages ─────────────────────────────────────────────────────────────────

class Message(BaseModel):
    role: str                             # "user" | "assistant"
    content: str
    created_at: str

# ── Annotations — discriminated union ───────────────────────────────────────
# Each annotation type is its own self-contained file on disk.
# Pydantic deserializes via the `type` discriminator field.

class AnnotationBase(BaseModel):
    id: str                               # format: "{type}/{uuid4}" e.g. "conversation/550e8400..."
    book_id: str
    chapter_id: str                       # stable ref — survives chapter reprocessing
    position: TextIndex                   # anchor point at time of creation
    created_at: str

class HighlightAnnotation(AnnotationBase):
    type: Literal["highlight"]
    start: TextIndex                      # inclusive start of highlighted span
    end: TextIndex                        # exclusive end — may be in a different paragraph
    selected_text: str                    # verbatim text of the span (for display and fallback rendering)
    content: str | None = None            # optional user note on the highlight

class NoteAnnotation(AnnotationBase):
    type: Literal["note"]
    content: str                          # required — a note without content is nothing

class ConversationAnnotation(AnnotationBase):
    type: Literal["conversation"]
    title: str | None = None              # auto-generated from first message; user can rename
    messages: list[Message] = []          # grows with conversation; lives only in this file

# Discriminated union — Pydantic deserializes via the `type` field
Annotation = Annotated[
    HighlightAnnotation | NoteAnnotation | ConversationAnnotation,
    Field(discriminator="type")
]

# ── Book ─────────────────────────────────────────────────────────────────────
# Book JSON is a pure index — metadata and reading state only.
# Annotations are not embedded; they live in their own files.

class Book(BaseModel):
    id: str
    title: str
    author: str
    epub_path: str                        # relative to BOOKS_DIR — keeps the app portable
    cover_base64: str | None = None       # extracted once at ingest, stored inline
    reading_position: TextIndex = TextIndex(chapter_index=0, paragraph_index=0, offset=0)
    chapters: list[Chapter] = []
```

---

### Request / Response models (`schemas.py`)

What the API accepts and returns. Projected from storage models by `store.py`.

```python
# ── Book schemas ─────────────────────────────────────────────────────────────

class BookSummaryResponse(BaseModel):
    """List view — no chapters, no annotations."""
    id: str
    title: str
    author: str
    cover_base64: str | None
    reading_position: TextIndex
    chapter_count: int
    annotation_count: int                 # derived from annotation directory scan

class BookDetailResponse(BookSummaryResponse):
    """Detail view — full book data including all chapter texts.
    Sent once on book open, held in frontend memory for the session.
    ~5MB worst case; negligible at personal app scale."""
    chapters: list[ChapterFullResponse]

class StateUpdateRequest(BaseModel):
    reading_position: TextIndex

# ── Chapter schemas ───────────────────────────────────────────────────────────

class ChapterFullResponse(BaseModel):
    """Complete chapter — metadata and paragraphs. Included in BookDetailResponse."""
    id: str
    index: int
    title: str
    paragraphs: list[str]
    paragraph_count: int
    is_summarized: bool
    summary: str | None = None

# ── Annotation schemas ────────────────────────────────────────────────────────

class HighlightCreateRequest(BaseModel):
    chapter_id: str
    start: TextIndex
    end: TextIndex
    selected_text: str
    content: str | None = None

class NoteCreateRequest(BaseModel):
    chapter_id: str
    position: TextIndex
    content: str

# ── Conversation schemas ──────────────────────────────────────────────────────

class ConversationCreateRequest(BaseModel):
    chapter_id: str
    position: TextIndex
    title: str | None = None

class ConversationResponse(BaseModel):
    """Single model for all conversation responses — no summary/full split needed."""
    id: str
    book_id: str
    chapter_id: str
    position: TextIndex
    title: str | None
    created_at: str
    messages: list[Message]

class MessageCreateRequest(BaseModel):
    content: str

class ConversationRenameRequest(BaseModel):
    title: str
```

---

### Storage layout

```
data/
  books/
    {id}.json               ← Book model — metadata, reading state, chapters only
    {id}.epub               ← original file
  annotations/
    {book_id}/
      {ann_id}.json         ← one file per annotation, self-contained
                            ← HighlightAnnotation and NoteAnnotation are tiny
                            ← ConversationAnnotation grows with messages
```

Annotations are loaded in parallel via `asyncio.gather` — directory scan fires all reads simultaneously, effectively instant at personal app scale. No index needed in the Book JSON.

```python
async def load_annotations(book_id: str) -> list[Annotation]:
    paths = (ANNOTATIONS_DIR / book_id).glob("*.json")
    return await asyncio.gather(*[load_annotation(p) for p in paths])
```

No database, no migrations. Adding a field = add it with a default, old files load fine forever.

---

## EPUB Ingestion Output Contract

`epub.py` runs once at upload time and produces a fully populated `Book` written to disk. The rest of the app never touches the EPUB again.

### Chapter text contract

- Chapters store a `paragraphs: list[str]` — not a single text string
- Each paragraph is plain text, HTML stripped, whitespace normalized
- Empty strings filtered out
- The list index IS the `paragraph_index` used throughout the app — this is the canonical position contract
- For context assembly, paragraphs are joined with `\n\n` when feeding to the AI

### Example output

```python
Book(
    id="550e8400-e29b-41d4-a716",
    title="The Idiot",
    author="Fyodor Dostoevsky",
    epub_path="550e8400.epub",
    cover_base64="data:image/jpeg;base64,...",
    current_chapter_index=0,
    semantic_paragraph_index=0,
    chapters=[
        Chapter(
            id="chapter/3f2a1b9c-...",
            index=0,
            title="Part I, Chapter I",
            paragraphs=[
                "At nine o'clock in the morning, towards the end of November...",
                "The train was approaching Petersburg at full speed...",
                "In the same compartment, directly facing the prince...",
                # ...
            ],
            summary=None,
            summarized_at=None
        ),
    ]
)
```

### Normalization pipeline (implementation detail)

The contract above is what matters. How `epub.py` produces it:

1. Walk spine items via `ebooklib`
2. For each spine item: extract HTML → strip all tags → normalize whitespace → split into paragraph list → filter empty strings
3. If a spine item exceeds ~10k words: split on `<h1>`/`<h2>` boundaries (best-effort guesser)
4. Assign title from `toc.ncx`/`nav.xhtml` → first `<h1>`/`<h2>` → `"Chapter N"` fallback
5. Generate `id` as `"chapter/{uuid4()}"`
6. Extract cover image → base64
7. Write `Book` to `{BOOKS_DIR}/{id}.json`

---

## Reading Position Tracker

Position is the ground truth of the entire app. But scroll position is not reading position — a user can scroll instantly through 200 paragraphs they haven't read. The reading position tracker is the module responsible for converting a raw stream of scroll samples into a clean `TextIndex` that represents where the AI considers the user to actually be in the story.

### The contract

```
Input:  stream of (timestamp, raw_paragraph_index) samples
Output: reading_position: TextIndex (monotonic, smoothed, persisted)
```

Any algorithm that satisfies this contract can be swapped in without touching anything else in the app. The rest of the system only ever sees `Book.reading_position`.

### Output constraints (enforced by all algorithms)

- **Monotonic** — reading position never moves backward except on explicit chapter navigation
- **Never exceeds raw** — reading position cannot be ahead of where the user has scrolled
- **Persisted** — written to `Book.reading_position` on a debounced interval via `PUT /books/{id}/state`
- **Layout-independent** — stored as `TextIndex`, not scroll pixels; restores correctly across devices and font sizes

### v0.1 algorithm — raw midpoint paragraph

The simplest possible implementation. Semantic position = the paragraph straddling the viewport midpoint. The `offset` field of `TextIndex` is set to 0 (paragraph-level granularity). No smoothing, no velocity gating. Good enough to validate the rest of the system.

```javascript
const sample = () => {
    const midY = window.innerHeight / 2;
    for (const p of document.querySelectorAll('p[data-paragraph]')) {
        const rect = p.getBoundingClientRect();
        if (rect.top <= midY && rect.bottom >= midY)
            return { paragraph_index: parseInt(p.dataset.paragraph), offset: 0 };
    }
};

// debounced — fires every 500ms
setInterval(() => {
    const raw = sample();
    if (raw !== null) updateReadingPosition(raw);
}, 500);
```

### Restoration

On book open, scroll to the saved paragraph via `element.scrollIntoView()`. This is layout-independent — the correct paragraph is always found regardless of font size or viewport.

### Future algorithms (NTH)

- **EMA with velocity gating** — exponential moving average, fast scroll treated as skimming and not advancing reading position
- **Dwell time weighted** — time spent in viewport weighted by paragraph length
- **Reading speed prior** — gate advancement against average reading speed (~2-3 paragraphs/minute), reject implausibly fast advances

The module is designed to be replaced. Start simple, instrument, improve.

---

## Context Assembly

### The three-zone window

Position is tracked as `Book.reading_position: TextIndex` — the output of the Reading Position Tracker module. See that section for how raw scroll samples are converted into this value.

```
[Previous chapters]
  → complete summaries (written on chapter advance)

[Current chapter: start → position.paragraph_index - N]
  → summary written lazily at conversation open, up to conversation's TextIndex
  → omitted entirely if conversation is within N paragraphs of chapter start

[Current chapter: position.paragraph_index - N → end of visible page]
  → verbatim text
```

**N = 15 paragraphs** (configurable via `N_VERBATIM_PARAGRAPHS`). When the N-back boundary crosses into the previous chapter, that text appears in both the previous chapter's summary AND the verbatim window. Intentional — the chapter seam is where continuity matters most.

Empty summary blocks are omitted from context entirely — never injected as blank sections.

### Full assembled context

```
[System prompt — naive reader persona]

[AI's memory: previous chapter summaries]
  Chapters 0 → current-1, concatenated
  Omitted if on chapter 0

[AI's memory: current chapter summary]
  Chapter start → conversation's TextIndex
  Written lazily before opening message if not already present
  Omitted if conversation is within N paragraphs of chapter start

[Verbatim window]
  N paragraphs back → current paragraph + page end

[Selected passage — if conversation was started from a highlight]
  "{selected_text}"
  This passage was highlighted by the reader at {TextIndex}.
  Omitted if conversation has no selected text

[Conversation history]

[User message]
```

---

## AI Prompts

### Haiku — Summarization

**Receives:** all previous chapter summaries (omitted on chapter 0) + chapter text to summarize.

**System prompt:**

```
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
developing threads — not to repeat what you already remember.
```

**User message (injected per call):**

```
# For complete chapter:
"Summarize chapter {n}: '{title}'. This is a complete chapter."

# For partial chapter:
"Summarize chapter {n}: '{title}' up to the current reading position.
This chapter is not yet complete — do not write as though it has ended."
```

**Trigger:**
- **Chapter complete** — fires when reader advances to next chapter. Full chapter text in, final summary out.
- **Conversation open** — fires lazily when a conversation is created, summarizing the current chapter up to the conversation's `paragraph_index`. Completes before the Sonnet opening message call; the latency blends into the opening message load time.

**Target length:** 150–300 words. Err toward completeness.

---

### Sonnet — Chat

```
You are a reading companion for "{title}" by {author}.

You are a reader, not a tutor. You have read this book up to exactly
the point described in your context — no further. You do not know what
happens next. You are not performing naivety; you are genuinely
constrained to what you have read.

Your context contains your memory of earlier chapters (summaries you
wrote as you read) and the exact text around the reader's current
position. Reason only from these. If something isn't in your context,
you don't know it.

Engage as a thoughtful fellow reader:
- Have opinions. Notice things. Be curious.
- Speculate freely about what might happen — you're allowed to be wrong.
- When something is ambiguous in the text, say so honestly rather than
  inventing certainty.
- Match the reader's register. If they're being playful, be playful.
  If they want to go deep, go deep.
- Don't over-explain or lecture. This is a conversation, not an essay.

The reader is at chapter {N} of {total}. What came before is memory.
What's in front of them is the page. Everything else is unknown to both
of you.
```

---

## Project Structure

```
reader/
├── backend/
│   ├── main.py           # FastAPI app, CORS config, route registration
│   ├── models.py         # Storage models (Book, Chapter, Annotation types, Message)
│   ├── schemas.py        # Request/response models projected from storage models
│   ├── store.py          # JSONStore — parallel annotation reads (asyncio.gather), storage→response projection
│   ├── epub.py           # EPUB ingestion, normalization pipeline, cover extraction
│   │                     # Note: ebooklib gives spine items, not guaranteed chapters.
│   │                     # Well-formed EPUBs (e.g. Gutenberg) work cleanly. Malformed
│   │                     # EPUBs may need best-effort h1/h2 boundary splitting.
│   │                     # Phase 1: parse what ebooklib gives. Add guesser if needed.
│   ├── context.py        # Context assembly — three-zone window, selected text seed, conversation history
│   ├── summarize.py      # Summarization pipeline (Haiku) — partial and complete chapter summaries
│   └── chat.py           # Conversation routes, opening message, SSE streaming
├── frontend/
│   │                     # File structure at Claude Code's discretion.
│   │                     # Three screens: Library, Reader, Chat.
│   │                     # See Frontend Layout and AI Interface sections for spec.
│   └── index.html
├── data/
│   ├── books/            # {id}.json + {id}.epub
│   └── annotations/      # {book_id}/{ann_id}.json — one file per annotation
├── requirements.txt
└── README.md
```

> **CORS:** FastAPI and Vite run on different ports locally. Add `CORSMiddleware` in `main.py` on day one or every API call will fail in the browser.

---

## API Routes

> **Why conversations have their own routes:** Conversations and annotations share a storage model (both are `Annotation` files) but collapsing them into one API surface forces every handler to branch on `type`. Separate routes keep handlers dumb and single-purpose — `chat.py` only knows about conversations, `annotations.py` only knows about highlights and notes. No `if annotation.type == "conversation"` scattered through the codebase. The `/messages` sub-route with SSE streaming is also genuinely conversation-specific and would be awkward under a generic annotations resource.

```
# Books
POST   /books/upload                                ← ingest EPUB → BookSummaryResponse
GET    /books                                       ← list → list[BookSummaryResponse]
GET    /books/{id}                                  ← full book + all chapters → BookDetailResponse
PUT    /books/{id}/state                            ← StateUpdateRequest → 204

# Chapters
POST   /books/{id}/chapters/{n}/summarize           ← manual summarization trigger → 202

# Annotations — highlights and notes
GET    /books/{id}/annotations                      ← list → list[Annotation]
POST   /books/{id}/annotations/highlight            ← HighlightCreateRequest → HighlightAnnotation
POST   /books/{id}/annotations/note                 ← NoteCreateRequest → NoteAnnotation
DELETE /books/{id}/annotations/{ann_id}             → 204
PATCH  /books/{id}/annotations/{ann_id}             ← partial update → Annotation

# Conversations
GET    /books/{id}/conversations                    ← list → list[ConversationResponse]
POST   /books/{id}/conversations                    ← ConversationCreateRequest → ConversationResponse
GET    /books/{id}/conversations/{ann_id}           ← ConversationResponse
POST   /books/{id}/conversations/{ann_id}/messages  ← MessageCreateRequest → SSE stream
PATCH  /books/{id}/conversations/{ann_id}           ← ConversationRenameRequest → ConversationResponse
DELETE /books/{id}/conversations/{ann_id}           → 204
```

---

## Streaming

Streaming uses **Server-Sent Events (SSE)** — unidirectional server-to-client, no WebSocket overhead needed.

**Backend** — FastAPI `StreamingResponse` + Anthropic streaming SDK:

```python
from fastapi.responses import StreamingResponse
import anthropic

client = anthropic.Anthropic()

async def stream_chat(ann_id: str, messages: list, system: str):
    with client.messages.stream(
        model="claude-sonnet-4-6",
        max_tokens=4096,  # literary conversation needs room
        system=system,
        messages=messages
    ) as stream:
        full_response = ""
        for text in stream.text_stream:
            full_response += text
            yield f"data: {text}\n\n"
    # signal stream end so frontend can finalize the message
    yield "event: done\ndata: [DONE]\n\n"
    # persist full assistant message after stream completes
    await append_message(ann_id, role="assistant", content=full_response)

@router.post("/books/{id}/conversations/{ann_id}/messages")
async def send_message(id: str, ann_id: str, body: MessageCreateRequest):
    system, messages = await assemble_context(id, ann_id, body.content)
    return StreamingResponse(
        stream_chat(ann_id, messages, system),
        media_type="text/event-stream"
    )
```

**Frontend** — ReadableStream API:

```javascript
const response = await fetch(
    `/books/${id}/conversations/${annId}/messages`,
    { method: 'POST', body: JSON.stringify({ content: userMessage }) }
);

const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value);
    if (chunk.includes("event: done")) {
        // stream complete — finalize message in UI
        finalizeMessage();
        break;
    }
    const text = chunk.replace(/^data: /, "");
    setStreamingText(prev => prev + text);
}
```

---

## Frontend Layout

Three screens. No split pane.

### Library Screen

The entry point. Cover grid, client-side search, upload. Gets out of the way fast.

```
┌─────────────────────────────────────────────┐
│  Bibliophile                          [+]   │  ← upload button
├─────────────────────────────────────────────┤
│  🔍 Search books...                         │  ← filters title + author, instant
├─────────────────────────────────────────────┤
│                                             │
│  ┌───────┐  ┌───────┐  ┌───────┐           │
│  │       │  │       │  │       │           │
│  │ cover │  │ cover │  │ cover │           │
│  │       │  │       │  │       │           │
│  │▓▓▓░░░░│  │▓▓▓▓▓▓░│  │       │           │  ← in-progress shows bar, unread shows nothing
│  └───────┘  └───────┘  └───────┘           │
│  The Idiot  Brothers K  Crime & P          │
│  Dostoevsky Dostoevsky  Dostoevsky         │
│                                             │
│  ┌───────┐  ┌───────┐  ┌───────┐           │
│  │       │  │       │  │       │           │
└─────────────────────────────────────────────┘
```

**Cover tile states:**
- **Unread** (`current_chapter_index == 0`) — cover only, no bar
- **In progress** — cover + progress bar along bottom, filled proportionally to `current_chapter_index / chapter_count`
- **Finished** — cover + full bar

Progress bar derived entirely from `BookSummaryResponse` — no extra data needed.

**Interactions:**
- Tap cover → straight into reader at last position, no intermediate screen
- Search filters on `title` and `author` simultaneously, client-side, instant — all book data already in memory from `GET /books`
- Upload button → file picker → ingest → cover appears in grid
- 3 columns on mobile, more on tablet/desktop

---

### Reader Screen

Full screen. This is where you read and where all navigation lives.

```
┌─────────────────────────────────────────────┐
│  ← Library    The Idiot — Ch 4 of 52    ⋮  │
├─────────────────────────────────────────────┤
│                                             │
│  ┃  At nine o'clock in the morning,        │  ← ┃ margin indicator (has annotation)
│     towards the end of November...         │
│                                             │
│     The train was approaching...           │
│                                             │
│  ●  "What do you make of this man?"        │  ← ● conversation indicator
│     said the general...                    │
│                                             │
│     Myshkin turned slowly...               │
│                                             │
├─────────────────────────────────────────────┤
│  ◀ prev          [💬 New Chat]    next ▶   │
└─────────────────────────────────────────────┘
```

- Margin indicators appear only where annotations or conversations exist — clean margin everywhere else
- Tap margin indicator → opens that annotation or conversation
- Highlight text → context menu → "Discuss" → creates conversation, navigates to Chat Screen
- **New Chat** button → creates conversation anchored to center paragraph → navigates to Chat Screen
- **Position tracked by midpoint paragraph** — debounced scroll finds the paragraph whose bounding rect straddles `window.innerHeight / 2`, persists its `data-index`
- Chapter advance triggers background summarization of departed chapter
- Mid-chapter summarization triggers every 20 paragraphs past N threshold

```javascript
// Paragraph tracking — part of Reading Position Tracker (v0.1 raw algorithm)
// Frontend renders each paragraph as <p data-index={i}>
// Sample fires every 500ms, finds paragraph straddling viewport midpoint
const sample = () => {
    const midY = window.innerHeight / 2;
    for (const p of document.querySelectorAll('p[data-index]')) {
        const rect = p.getBoundingClientRect();
        if (rect.top <= midY && rect.bottom >= midY)
            return parseInt(p.dataset.index);
    }
};
```

### Chat Screen

Full screen. One conversation. Accessed only from the reader screen.

```
┌─────────────────────────────────────────────┐
│  ← Back         Ch 4 · ¶ 12           ⋮   │
├─────────────────────────────────────────────┤
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │ "What do you make of this man?"     │   │  ← selected text quote (if any)
│  │  said the general...                │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  ╭─────────────────────────────────────╮   │
│  │ AI  There's something almost        │   │  ← AI opening message
│  │     deliberately opaque about the   │   │
│  │     way he's introduced...          │   │
│  ╰─────────────────────────────────────╯   │
│                                             │
│        ╭───────────────────────────╮        │
│        │ You  What do you think    │        │
│        │      he wants?            │        │
│        ╰───────────────────────────╯        │
│                                             │
├─────────────────────────────────────────────┤
│  [                          ] [Send]       │
└─────────────────────────────────────────────┘
```

- Back button returns to reader at same position
- Chapter and paragraph shown in top bar for orientation
- No conversation list in this screen — conversations are accessed via margin indicators in the Reader screen
- Streaming response renders in place as it arrives

---

## AI Interface

### Interaction model

**Starting a new conversation:**
A single "New Chat" button in the main UI. Defaults to the current center paragraph (the midpoint paragraph index). Creates a `ConversationAnnotation` anchored there with no `selected_text`. Navigates to Chat screen, AI sends an opening message.

**Highlight to discuss:**
Select text → context menu → "Discuss". Creates a conversation with `selected_text` set, anchored to that paragraph. Navigates to Chat screen with passage quoted at top.

**Opening existing conversations:**
Margin indicators appear only on paragraphs that have existing annotations or conversations — not on every paragraph. Purely informational, no empty affordances cluttering the margin. Tap a margin indicator to open the annotation or conversation.

Every paragraph in the margin is clean unless something lives there.

### Chat Screen states

- **New conversation** — opens with selected text quoted at top (if any), AI opening message fires automatically, input focused.
- **Existing conversation** — full message history loaded, input at bottom, ready to continue.

### Opening message

`POST /books/{id}/conversations` creates the conversation and immediately fires a Sonnet call to generate the opening message. The response streams back to the frontend as SSE — same streaming path as regular messages. The opening message is stored as the first `Message` in the `ConversationAnnotation` with `role: "assistant"`.

**Opening message system prompt** (used only for this call, not for subsequent messages):

```
You are a reading companion for "{title}" by {author}.

You have just been invited into a conversation at chapter {N}, paragraph {P}.
Your only knowledge of the story comes from what is provided in your context.

React to this moment the way a fellow reader would — with immediacy and curiosity.
Notice something specific. Ask something genuine. Be brief.
This is the opening of a conversation, not a summary or an essay.
Do not introduce yourself. Just begin.
```

The assembled context for this call is identical to a regular chat message — three-zone window + previous chapter summaries + selected text if present (see below).

### Selected text as conversation seed

When a conversation is created via highlight-to-discuss, `selected_text` is stored on the `ConversationAnnotation`. It is injected into the context assembly for every message in that conversation as a dedicated block:

```
[Selected passage — conversation seed]
  "{selected_text}"
  This passage was highlighted by the reader at chapter {N}, paragraph {P}.
```

Injected after the verbatim window, before conversation history. The AI always knows what passage seeded this conversation, even many messages later.

### Context assembly on message send

The frontend passes `paragraph_index` as navigation state when transitioning to the Chat screen. The backend uses this plus the stored book state for context assembly — the frontend doesn't need to send chapter text. `paragraph_index` is the only position signal the frontend is responsible for passing.

---

## Visual Design

Bibliophile uses the Anthropic color palette — warm, human, and deliberately not the cold blue-tech aesthetic of most AI products. This fits the app's soul: it's about reading, which is a warm and intimate act.

Two guiding principles in tension, both non-negotiable:

**Soft and natural.** The palette is warm, the typography is human, the interactions feel considered rather than mechanical. This is not a productivity tool. It is a place to spend time with books.

**Ruthlessly minimal.** Every pixel of UI chrome is a pixel stolen from the text. Navigation bars, buttons, indicators — all should be as small, subtle, and dismissible as possible. When you're reading, the UI should nearly disappear. Content is the product. Chrome is overhead.

In practice: UI elements are present but quiet. They appear when needed and recede when not. The reader screen in particular should feel as close to a blank page as possible — the text fills the screen, everything else is a whisper at the edges.

**Core palette:**

| Role | Color | Hex |
|---|---|---|
| Background | Off-white | `#faf9f5` |
| Surface (cards, panes) | Light gray | `#e8e6dc` |
| Muted text / secondary | Mid gray | `#b0aea5` |
| Primary text | Near black | `#141413` |
| Accent (interactive, active) | Orange | `#d97757` |
| Secondary accent | Blue | `#6a9bcc` |
| Tertiary accent | Green | `#788c5d` |

**Application:**
- Reader pane background: `#faf9f5` — warm off-white, easy on the eyes for long reading sessions
- Chat pane background: `#e8e6dc` — slightly distinct from reader, clear separation without harsh contrast
- Margin indicators: `#b0aea5` default, `#d97757` when active or has content
- Highlights: `#d97757` at low opacity as background tint
- Conversation bubbles: user in `#d97757` tint, AI in white on `#e8e6dc`
- Interactive elements, focus states: `#d97757`

Typography follows the reading context — a serif for chapter text (Georgia or similar), clean sans-serif for UI chrome and chat.

---

## Build Order

### Phase 1 — Working Reader (no AI)
1. `models.py` + `schemas.py` — all models and schemas defined upfront
2. `store.py` — JSONStore, parallel annotation reads, storage→response projection
3. `epub.py` — ingest EPUB, normalize to Chapter list, extract cover, write Book JSON
4. Backend routes — upload, list, book detail (full chapters), update state, summarize trigger
5. `Library.jsx` — cover grid, client-side search, upload button
6. `Reader.jsx` — render chapter text, `p[data-index]` paragraph tagging, midpoint tracking, position persistence, margin indicators, prev/next navigation

**Exit condition:** Can upload an EPUB, browse library, read start to finish, position saved between sessions.

### Phase 2 — Annotations
1. Annotation CRUD routes — highlight and note creation, retrieval, deletion
2. Text selection → highlight/note creation in the reader
3. Margin indicators by type (conversation vs highlight vs note)
4. `AnnotationBase` wired to chapter position via `chapter_id` + `paragraph_index`

**Exit condition:** Can highlight text, leave notes, see all annotations as margin indicators anchored to their paragraphs.

### Phase 3 — Summarization Pipeline
1. `summarize.py` — Haiku call with complete/partial flag, previous summaries as context, write into `Chapter.summary`
2. Hook into chapter advance — complete summary fires on navigation
3. Hook into conversation open — lazy summary of current chapter up to `paragraph_index`, runs before opening message

**Exit condition:** Advancing through chapters generates and stores summaries silently. Opening a conversation in a mid-chapter position summarizes up to that point before the AI responds.

### Phase 4 — AI Chat
1. `context.py` — three-zone window assembly, selected text seed injection, conversation history
2. `chat.py` — conversation CRUD, opening message on `POST /conversations`, SSE streaming
3. Chat screen — full screen conversation view, streaming display, back navigation
4. Wire Reader → Chat navigation — New Chat button, highlight-to-discuss context menu, margin indicator tap
5. Auto-generate conversation title from first user message (Haiku, one-shot, background)

**Exit condition:** Can start a conversation from anywhere in the reader, exchange messages with the AI, return to reading position.

---

## Environment Variables

```
ANTHROPIC_API_KEY=
BOOKS_DIR=./data/books
ANNOTATIONS_DIR=./data/annotations
HAIKU_MODEL=claude-haiku-4-5-20251001
SONNET_MODEL=claude-sonnet-4-6
N_VERBATIM_PARAGRAPHS=15
CORS_ORIGINS=http://localhost:5173
```

---

---

## Known Limitations (v0.1)

These are acknowledged bugs and architectural gaps deferred to future versions. Claude Code should not attempt to solve them in v0.1.

**Context window creep** — for very long books (War and Peace, ~360 chapters), concatenated chapter summaries will eventually exceed the model's context window. Fix: rolling window with meta-summary compression — groups of early chapters get recursively re-summarized into a single block. Not needed until the app is actually used on long books.

**Next-chapter spam** — if the user navigates forward through several chapters rapidly, a complete summarization task fires for each departed chapter. The in-flight guard prevents duplicate tasks for the same chapter, but N rapid advances still launch N concurrent Haiku calls. Fix: a global summarization queue with a single worker. Deferred — unlikely in normal reading, and each task is independently correct.

**EPUB normalization edge cases** — the paragraph extraction pipeline assumes relatively well-behaved EPUBs (Gutenberg-quality). Malformed EPUBs with inline `<br>`, poetry blocks, footnotes, and Gutenberg artifacts may produce inconsistent paragraph lists. Fix: more aggressive normalization and a test suite across a large EPUB sample. Deferred pending real-world testing.

**Naive mode leakage** — the model's constraint to context-only is enforced by prompt discipline, not architecture. The model may occasionally surface knowledge of the text beyond the current reading position. Fix: future versions can experiment with prompt hardening techniques and measure leakage rates.

**Selection opens nearby highlight panel** — after finishing a text selection, the annotation panel for a nearby (unrelated) highlight sometimes opens as if clicked. Root cause: the `onClick` handler on `<p data-paragraph>` fires after `mouseup`, and the paragraph's annotation map entry includes a nearby highlight. No fix planned for v0.1.

---

## Nice To Have (NTH)

Features and improvements that are out of scope for v0.1 but worth tracking for future versions.

- **RAG / vector search** — semantic search over read chapters for specific passage recall. Summaries carry the load in v0.1; RAG adds precision for long books.
- **Context caching** — assembled context is rebuilt on every message. Cache keyed on `(book_id, chapter_index, semantic_paragraph_index)` would eliminate redundant work in active conversations.
- **Advanced reading position algorithms** — EMA with velocity gating, dwell time weighting, reading speed prior. See Reading Position Tracker section.
- **Meta-summary compression** — rolling window compression of early chapter summaries for very long books. See Known Limitations.
- **Persisted pinned context** — pin annotations or conversation excerpts as permanent context for the AI. Frontend-only in v0.1.
- **Naive mode leakage testing** — systematic experiments to measure and minimize model knowledge leakage beyond reading position. Explore stripping author/title from prompts, adversarial probing, and prompt hardening techniques.
- **PDF support** — after EPUB pipeline is proven stable.
- **Mobile layout** — Capacitor wrapper for iOS/Android after web prototype is validated.
- **Annotation export** — export highlights, notes, and conversations as markdown or PDF.
- **Search within book** — full-text search across chapter paragraph lists.
- **Multiple AI modes** — companion mode (model has full knowledge, constrained expression) alongside naive mode.
- **EPUB normalization hardening** — test suite across large EPUB sample, handle malformed edge cases.
- **Cloud sync** — sync reading state and annotations across devices.