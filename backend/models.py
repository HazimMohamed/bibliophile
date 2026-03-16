from pydantic import BaseModel, Field
from typing import Annotated, Literal


class Chapter(BaseModel):
    id: str
    index: int
    title: str
    part: str | None = None           # e.g. "PART I", "PART II" — None if book has no parts
    paragraphs: list[str]
    summary: str | None = None
    summarized_at: str | None = None
    summarized_to_paragraph: int | None = None  # last paragraph included in the current summary


class Message(BaseModel):
    role: str
    content: str
    created_at: str


class AnnotationBase(BaseModel):
    id: str
    book_id: str
    chapter_id: str
    chapter_index: int
    paragraph_index: int
    created_at: str


class HighlightAnnotation(AnnotationBase):
    type: Literal["highlight"]
    selected_text: str
    content: str | None = None
    start_offset: int | None = None
    end_offset: int | None = None


class NoteAnnotation(AnnotationBase):
    type: Literal["note"]
    content: str


class ConversationAnnotation(AnnotationBase):
    type: Literal["conversation"]
    title: str | None = None
    messages: list[Message] = []


Annotation = Annotated[
    HighlightAnnotation | NoteAnnotation | ConversationAnnotation,
    Field(discriminator="type"),
]


class Book(BaseModel):
    id: str
    title: str
    author: str
    epub_path: str
    cover_base64: str | None = None
    current_chapter_index: int = 0
    semantic_paragraph_index: int = 0
    chapters: list[Chapter] = []
