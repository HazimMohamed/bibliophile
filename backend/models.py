from pydantic import BaseModel, Field
from typing import Annotated, Literal


# ── Position ──────────────────────────────────────────────────────────────────

class TextIndex(BaseModel):
    """A content-anchored position within a book.
    Survives layout changes, font resizes, and viewport differences.
    Supports natural ordering: (chapter_index, paragraph_index, offset)."""
    chapter_index: int
    paragraph_index: int
    offset: int                           # character offset within the paragraph text


# ── Chapters ─────────────────────────────────────────────────────────────────

class Chapter(BaseModel):
    id: str                               # format: "chapter/{uuid4}"
    index: int
    title: str
    part: str | None = None               # e.g. "PART I" — None if book has no parts
    paragraphs: list[str]
    summary: str | None = None
    summarized_at: str | None = None


# ── Messages ──────────────────────────────────────────────────────────────────

class Message(BaseModel):
    role: str                             # "user" | "assistant"
    content: str
    created_at: str


# ── Annotations — discriminated union ────────────────────────────────────────

_DEFAULT_POSITION = TextIndex(chapter_index=0, paragraph_index=0, offset=0)


class AnnotationBase(BaseModel):
    id: str                               # format: "{type}/{uuid4}"
    book_id: str
    chapter_id: str
    position: TextIndex = Field(default_factory=lambda: TextIndex(chapter_index=0, paragraph_index=0, offset=0))
    created_at: str


class RangedAnnotation(AnnotationBase):
    """Base for annotations anchored to a text range (start → end + selected_text)."""
    start: TextIndex = Field(default_factory=lambda: TextIndex(chapter_index=0, paragraph_index=0, offset=0))
    end: TextIndex = Field(default_factory=lambda: TextIndex(chapter_index=0, paragraph_index=0, offset=0))
    selected_text: str = ""


class HighlightAnnotation(RangedAnnotation):
    type: Literal["highlight"]
    content: str | None = None


class NoteAnnotation(RangedAnnotation):
    type: Literal["note"]
    content: str


class ConversationAnnotation(RangedAnnotation):
    type: Literal["conversation"]
    title: str | None = None
    messages: list[Message] = []


Annotation = Annotated[
    HighlightAnnotation | NoteAnnotation | ConversationAnnotation,
    Field(discriminator="type"),
]


# ── Book ──────────────────────────────────────────────────────────────────────

class Book(BaseModel):
    id: str
    title: str
    author: str
    epub_path: str
    cover_base64: str | None = None
    cover_source: str | None = None   # "epub" | "svg" | "ai" | None
    reading_position: TextIndex = Field(
        default_factory=lambda: TextIndex(chapter_index=0, paragraph_index=0, offset=0)
    )
    chapters: list[Chapter] = []
