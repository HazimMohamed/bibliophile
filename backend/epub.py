import base64
import re
import shutil
import uuid

_PART_RE = re.compile(r'^(PART|BOOK|VOLUME|SECTION)\b', re.IGNORECASE)
from pathlib import Path

import ebooklib
from ebooklib import epub
from bs4 import BeautifulSoup

from .covers import default_cover_service
from .models import Book, Chapter
from .store import BOOKS_DIR, store


def _normalize_whitespace(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _extract_cover(book: epub.EpubBook) -> str | None:
    cover_item = None

    # Try metadata-declared cover
    cover_meta = book.get_metadata("OPF", "cover")
    if cover_meta:
        cover_id = cover_meta[0][1].get("content", "")
        if cover_id:
            try:
                cover_item = book.get_item_with_id(cover_id)
            except Exception:
                pass

    # Fall back: scan items for "cover" in name/id
    if cover_item is None:
        for item in book.get_items():
            if item.get_type() == ebooklib.ITEM_IMAGE:
                name = (item.get_name() or "").lower()
                item_id = (item.id or "").lower()
                if "cover" in name or "cover" in item_id:
                    cover_item = item
                    break

    if cover_item is None:
        return None

    data = cover_item.get_content()
    if not data:
        return None

    name = (cover_item.get_name() or "").lower()
    if name.endswith(".png"):
        mime = "image/png"
    elif name.endswith(".gif"):
        mime = "image/gif"
    elif name.endswith(".webp"):
        mime = "image/webp"
    else:
        mime = "image/jpeg"

    encoded = base64.b64encode(data).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def _extract_title_from_html(html: str) -> str | None:
    soup = BeautifulSoup(html, "lxml")
    for tag in ("h1", "h2"):
        heading = soup.find(tag)
        if heading:
            text = _normalize_whitespace(heading.get_text())
            if text:
                return text
    return None


def _parse_paragraphs(html: str) -> list[str]:
    soup = BeautifulSoup(html, "lxml")
    paragraphs: list[str] = []

    # Try <p> tag extraction first
    p_tags = soup.find_all("p")
    if p_tags:
        for p in p_tags:
            text = _normalize_whitespace(p.get_text())
            if text and len(text) >= 10:
                paragraphs.append(text)
    else:
        # Fall back to full text split on double newlines
        full_text = soup.get_text()
        chunks = re.split(r"\n\s*\n", full_text)
        for chunk in chunks:
            text = _normalize_whitespace(chunk)
            if text and len(text) >= 10:
                paragraphs.append(text)

    return paragraphs


def _split_large_chapter(html: str) -> list[tuple[str | None, list[str]]]:
    """Split HTML into sections by heading boundaries if content is large.
    Returns list of (title, paragraphs) pairs."""
    soup = BeautifulSoup(html, "lxml")
    word_count = len(soup.get_text().split())

    if word_count <= 10000:
        return [(None, _parse_paragraphs(html))]

    # Walk all headings and paragraphs in document order, split on any heading tag
    sections: list[tuple[str | None, list[str]]] = []
    current_title: str | None = None
    current_paragraphs: list[str] = []

    for tag in soup.find_all(["h1", "h2", "h3", "p"]):
        if tag.name in ("h1", "h2", "h3"):
            # Always emit the current section (even if empty) so part markers aren't lost
            sections.append((current_title, current_paragraphs))
            current_paragraphs = []
            current_title = _normalize_whitespace(tag.get_text())
        else:
            text = _normalize_whitespace(tag.get_text())
            if text and len(text) >= 10:
                current_paragraphs.append(text)

    sections.append((current_title, current_paragraphs))

    if len(sections) <= 1:
        return [(None, _parse_paragraphs(html))]

    return sections


def _get_toc_titles(book: epub.EpubBook) -> dict[str, str]:
    """Map spine item hrefs to TOC titles."""
    titles: dict[str, str] = {}

    def _walk_toc(toc_items):
        for item in toc_items:
            if isinstance(item, tuple):
                section, children = item
                if hasattr(section, "href") and hasattr(section, "title"):
                    href = section.href.split("#")[0]
                    if section.title:
                        titles[href] = section.title
                _walk_toc(children)
            elif hasattr(item, "href") and hasattr(item, "title"):
                href = item.href.split("#")[0]
                if item.title:
                    titles[href] = item.title

    _walk_toc(book.toc)
    return titles


async def ingest_epub(file_path: str, original_filename: str) -> Book:
    book_id = str(uuid.uuid4())
    epub_book = epub.read_epub(file_path)

    # Extract metadata
    title_meta = epub_book.get_metadata("DC", "title")
    title = title_meta[0][0] if title_meta else original_filename.rsplit(".", 1)[0]

    author_meta = epub_book.get_metadata("DC", "creator")
    author = author_meta[0][0] if author_meta else "Unknown"

    extracted_cover = _extract_cover(epub_book)
    if extracted_cover:
        cover_base64 = extracted_cover
        cover_source = "epub"
    else:
        cover_base64 = await default_cover_service.generate(title, author)
        cover_source = "svg"
    toc_titles = _get_toc_titles(epub_book)

    # Process spine items
    chapters: list[Chapter] = []
    chapter_index = 0
    current_part: str | None = None

    spine_items = epub_book.spine
    for spine_id, _ in spine_items:
        item = epub_book.get_item_with_id(spine_id)
        if item is None:
            continue
        if item.get_type() != ebooklib.ITEM_DOCUMENT:
            continue

        html = item.get_content().decode("utf-8", errors="replace")
        item_href = item.get_name()

        parts = _split_large_chapter(html)

        for part_idx, (part_title, paragraphs) in enumerate(parts):
            # Capture part markers (e.g. "PART I") regardless of paragraph count
            if part_title and _PART_RE.match(part_title):
                current_part = part_title
                if not paragraphs:
                    continue

            if not paragraphs:
                continue

            # Paragraphs before the first heading in a multi-section spine item
            # are the tail of the previous chapter spilling across a file boundary.
            # Append them rather than creating a new chapter.
            if part_title is None and part_idx == 0 and len(parts) > 1 and chapters:
                chapters[-1].paragraphs.extend(paragraphs)
                continue

            # Determine title: TOC > part split title > HTML heading > fallback
            ch_title = None
            if item_href in toc_titles and len(parts) == 1:
                ch_title = toc_titles[item_href]
            if not ch_title and part_title and not _PART_RE.match(part_title):
                ch_title = part_title
            if not ch_title:
                ch_title = _extract_title_from_html(html)
            if not ch_title:
                ch_title = f"Chapter {chapter_index + 1}"

            chapter = Chapter(
                id=f"chapter/{uuid.uuid4()}",
                index=chapter_index,
                title=ch_title,
                part=current_part,
                paragraphs=paragraphs,
            )
            chapters.append(chapter)
            chapter_index += 1

    # Save epub file
    BOOKS_DIR.mkdir(parents=True, exist_ok=True)
    epub_dest = BOOKS_DIR / f"{book_id}.epub"
    shutil.copy2(file_path, str(epub_dest))

    book = Book(
        id=book_id,
        title=title,
        author=author,
        epub_path=str(epub_dest),
        cover_base64=cover_base64,
        cover_source=cover_source,
        chapters=chapters,
    )

    await store.save_book(book)
    return book
