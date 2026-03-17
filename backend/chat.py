import uuid
from datetime import datetime

import anthropic
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from .context import assemble_context, SONNET_MODEL
from .models import ConversationAnnotation, Message
from .schemas import ConversationCreateRequest, ConversationResponse, MessageCreateRequest
from .store import store

router = APIRouter()


def _now() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _to_response(ann: ConversationAnnotation) -> ConversationResponse:
    return ConversationResponse(
        id=ann.id,
        type=ann.type,
        book_id=ann.book_id,
        chapter_id=ann.chapter_id,
        start=ann.start,
        end=ann.end,
        selected_text=ann.selected_text,
        title=ann.title,
        created_at=ann.created_at,
        messages=ann.messages,
    )


@router.post("/books/{book_id}/conversations")
async def create_conversation(book_id: str, req: ConversationCreateRequest):
    await store.get_book(book_id)
    ann = ConversationAnnotation(
        id=f"conversation/{uuid.uuid4()}",
        book_id=book_id,
        chapter_id=req.chapter_id,
        position=req.start,
        start=req.start,
        end=req.end,
        selected_text=req.selected_text,
        title=req.title,
        created_at=_now(),
        type="conversation",
    )
    await store.save_annotation(book_id, ann)
    return _to_response(ann)


@router.get("/books/{book_id}/conversations/{ann_id:path}")
async def get_conversation(book_id: str, ann_id: str):
    ann = await store.get_annotation(book_id, ann_id)
    return _to_response(ann)


@router.post("/books/{book_id}/conversations/{ann_id:path}/messages")
async def send_message(book_id: str, ann_id: str, body: MessageCreateRequest):
    return StreamingResponse(
        _stream(book_id, ann_id, body.content),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


async def _stream(book_id: str, ann_id: str, user_content: str):
    try:
        book = await store.get_book(book_id)
        conv = await store.get_annotation(book_id, ann_id)
        is_opening = not user_content.strip()

        if not is_opening:
            conv.messages.append(Message(role="user", content=user_content, created_at=_now()))
            await store.save_annotation(book_id, conv)

        system, messages = assemble_context(book, conv, is_opening=is_opening)
        if not is_opening:
            messages.append({"role": "user", "content": user_content})

        client = anthropic.AsyncAnthropic()
        full = ""
        async with client.messages.stream(
            model=SONNET_MODEL, max_tokens=2048, system=system, messages=messages
        ) as stream:
            async for text in stream.text_stream:
                full += text
                yield f"data: {text}\n\n"

        conv.messages.append(Message(role="assistant", content=full, created_at=_now()))
        await store.save_annotation(book_id, conv)
        yield "event: done\ndata: [DONE]\n\n"
    except Exception as e:
        import logging
        logging.getLogger("bibliophile.chat").error("Stream error: %s", e)
        yield f"event: error\ndata: {str(e)}\n\n"
