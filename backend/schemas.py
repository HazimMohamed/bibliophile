from pydantic import BaseModel

from .models import Message, TextIndex


class BookSummaryResponse(BaseModel):
    id: str
    title: str
    author: str
    cover_base64: str | None
    reading_position: TextIndex
    chapter_count: int
    annotation_count: int


class ChapterFullResponse(BaseModel):
    id: str
    index: int
    title: str
    part: str | None
    paragraphs: list[str]
    paragraph_count: int
    is_summarized: bool
    summary: str | None = None


class BookDetailResponse(BookSummaryResponse):
    chapters: list[ChapterFullResponse]


class StateUpdateRequest(BaseModel):
    reading_position: TextIndex


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


class ConversationCreateRequest(BaseModel):
    chapter_id: str
    position: TextIndex
    selected_text: str | None = None
    title: str | None = None


class ConversationResponse(BaseModel):
    id: str
    book_id: str
    chapter_id: str
    position: TextIndex
    title: str | None
    selected_text: str | None
    created_at: str
    messages: list[Message]


class MessageCreateRequest(BaseModel):
    content: str


class ConversationRenameRequest(BaseModel):
    title: str
