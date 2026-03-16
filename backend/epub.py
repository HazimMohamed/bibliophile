import base64
import re
import shutil
import uuid

_PART_RE = re.compile(r'^(PART|BOOK|VOLUME|SECTION)\b', re.IGNORECASE)
from pathlib import Path

import ebooklib
from ebooklib import epub
from bs4 import BeautifulSoup

from .models import Book, Chapter
from .store import BOOKS_DIR, store


def _normalize_whitespace(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


_COVER_PALETTES = [
    ("#2a1f1a", "#d97757", "#f0e8e0"),  # warm dark brown · orange · cream
    ("#1a2028", "#6a9bcc", "#e0e8f0"),  # dark navy · blue · pale
    ("#1a2520", "#788c5d", "#e0ece0"),  # dark forest · green · sage
    ("#28201a", "#c9956a", "#f0e4d8"),  # rust · amber · warm cream
    ("#221a28", "#9b7ab8", "#ece0f0"),  # plum · lavender · pale
    ("#1e2520", "#5e8c7a", "#d8ece8"),  # deep teal · teal · light
]

# SVG cover font tiers (largest → smallest); first tier where all lines fit is used.
_COVER_TIERS = [
    dict(font_size=21, letter_spacing=2,   line_height=31, max_chars=9),
    dict(font_size=18, letter_spacing=1.5, line_height=28, max_chars=11),
    dict(font_size=15, letter_spacing=1,   line_height=25, max_chars=13),
    dict(font_size=13, letter_spacing=1,   line_height=23, max_chars=15),
    dict(font_size=11, letter_spacing=0.5, line_height=21, max_chars=18),
]
_CHAR_WIDTH = 0.68   # approx char width as fraction of font-size (Georgia caps)
_SAFE_WIDTH = 158    # max rendered line width in SVG units (200 - 2×21 margin)


def _pick_cover_tier(title_upper: str):
    for tier in _COVER_TIERS:
        lines = _wrap_text(title_upper, tier["max_chars"])
        # All lines must fit within the safe width.
        fs, ls = tier["font_size"], tier["letter_spacing"]
        if not all(len(l) * fs * _CHAR_WIDTH + (len(l) - 1) * ls <= _SAFE_WIDTH for l in lines):
            continue
        # Reject if any non-leading line is a lone short word (e.g. "THE" orphan).
        if len(lines) > 1 and any(
            len(line.split()) == 1 and len(line) <= 3 for line in lines[1:]
        ):
            continue
        return tier, lines
    tier = _COVER_TIERS[-1]
    return tier, _wrap_text(title_upper, tier["max_chars"])


def _wrap_text(text: str, max_chars: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        if not current:
            current = word
        elif len(current) + 1 + len(word) <= max_chars:
            current += " " + word
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines or [""]


def _generate_cover_svg(title: str, author: str) -> str:
    """Generate a simple SVG title-page cover for books without a cover image."""
    bg, accent, text_color = _COVER_PALETTES[abs(hash(title)) % len(_COVER_PALETTES)]
    w, h = 200, 300

    tier, title_lines = _pick_cover_tier(title.upper())
    font_size = tier["font_size"]
    letter_spacing = tier["letter_spacing"]
    line_height = tier["line_height"]

    title_block_h = len(title_lines) * line_height
    title_start_y = (h - title_block_h) / 2 - 10

    title_elems = "".join(
        f'<text x="{w // 2}" y="{title_start_y + i * line_height:.0f}" '
        f'text-anchor="middle" font-family="Georgia,serif" font-size="{font_size}" '
        f'font-weight="bold" fill="{text_color}" letter-spacing="{letter_spacing}">{line}</text>'
        for i, line in enumerate(title_lines)
    )

    rule_top    = f"{title_start_y - 40:.0f}"
    rule_bottom = f"{title_start_y + title_block_h + 8:.0f}"
    author_y    = f"{title_start_y + title_block_h + 38:.0f}"
    author_str  = author if len(author) <= 26 else author[:24] + "\u2026"

    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}">'
        f'<rect width="{w}" height="{h}" fill="{bg}"/>'
        f'<rect x="10" y="10" width="{w - 20}" height="{h - 20}" fill="none" '
        f'stroke="{accent}" stroke-width="0.5" opacity="0.4"/>'
        f'<line x1="40" y1="{rule_top}" x2="{w - 40}" y2="{rule_top}" '
        f'stroke="{accent}" stroke-width="1"/>'
        f'{title_elems}'
        f'<line x1="40" y1="{rule_bottom}" x2="{w - 40}" y2="{rule_bottom}" '
        f'stroke="{accent}" stroke-width="1"/>'
        f'<text x="{w // 2}" y="{author_y}" text-anchor="middle" '
        f'font-family="Georgia,serif" font-size="11" fill="{text_color}" '
        f'opacity="0.65" letter-spacing="1">{author_str}</text>'
        f'</svg>'
    )
    encoded = base64.b64encode(svg.encode()).decode("ascii")
    return f"data:image/svg+xml;base64,{encoded}"


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

    cover_base64 = _extract_cover(epub_book) or _generate_cover_svg(title, author)
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
        chapters=chapters,
    )

    await store.save_book(book)
    return book
