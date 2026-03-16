from pydantic import BaseModel

from .models import Message


class BookSummaryResponse(BaseModel):
    id: str
    title: str
    author: str
    cover_base64: str | None
    current_chapter_index: int
    semantic_paragraph_index: int
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


class BookDetailResponse(BookSummaryResponse):
    chapters: list[ChapterFullResponse]


class StateUpdateRequest(BaseModel):
    current_chapter_index: int
    semantic_paragraph_index: int


class HighlightCreateRequest(BaseModel):
    chapter_id: str
    chapter_index: int
    paragraph_index: int
    selected_text: str
    content: str | None = None
    start_offset: int | None = None
    end_offset: int | None = None


class NoteCreateRequest(BaseModel):
    chapter_id: str
    chapter_index: int
    paragraph_index: int
    content: str


class ConversationCreateRequest(BaseModel):
    chapter_id: str
    chapter_index: int
    paragraph_index: int
    title: str | None = None


class ConversationResponse(BaseModel):
    id: str
    book_id: str
    chapter_id: str
    chapter_index: int
    paragraph_index: int
    title: str | None
    created_at: str
    messages: list[Message]


class MessageCreateRequest(BaseModel):
    content: str


class ConversationRenameRequest(BaseModel):
    title: str
