import base64
import re
from abc import ABC, abstractmethod


_COVER_PALETTES = [
    ("#2a1f1a", "#d97757", "#f0e8e0"),  # warm dark brown · orange · cream
    ("#1a2028", "#6a9bcc", "#e0e8f0"),  # dark navy · blue · pale
    ("#1a2520", "#788c5d", "#e0ece0"),  # dark forest · green · sage
    ("#28201a", "#c9956a", "#f0e4d8"),  # rust · amber · warm cream
    ("#221a28", "#9b7ab8", "#ece0f0"),  # plum · lavender · pale
    ("#1e2520", "#5e8c7a", "#d8ece8"),  # deep teal · teal · light
]

_COVER_TIERS = [
    dict(font_size=21, letter_spacing=2,   line_height=31, max_chars=9),
    dict(font_size=18, letter_spacing=1.5, line_height=28, max_chars=11),
    dict(font_size=15, letter_spacing=1,   line_height=25, max_chars=13),
    dict(font_size=13, letter_spacing=1,   line_height=23, max_chars=15),
    dict(font_size=11, letter_spacing=0.5, line_height=21, max_chars=18),
]
_CHAR_WIDTH = 0.68
_SAFE_WIDTH = 158


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


def _pick_cover_tier(title_upper: str):
    for tier in _COVER_TIERS:
        lines = _wrap_text(title_upper, tier["max_chars"])
        fs, ls = tier["font_size"], tier["letter_spacing"]
        if not all(len(l) * fs * _CHAR_WIDTH + (len(l) - 1) * ls <= _SAFE_WIDTH for l in lines):
            continue
        if len(lines) > 1 and any(
            len(line.split()) == 1 and len(line) <= 3 for line in lines[1:]
        ):
            continue
        return tier, lines
    tier = _COVER_TIERS[-1]
    return tier, _wrap_text(title_upper, tier["max_chars"])


def _build_svg(title: str, author: str) -> str:
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

    return (
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


class CoverGenerator(ABC):
    @abstractmethod
    async def generate(self, title: str, author: str) -> str | None:
        """Return a base64 data URI or None if generation failed/unsupported."""
        ...


class SvgCoverGenerator(CoverGenerator):
    async def generate(self, title: str, author: str) -> str | None:
        svg = _build_svg(title, author)
        b64 = base64.b64encode(svg.encode()).decode()
        return f"data:image/svg+xml;base64,{b64}"


class CoverService:
    def __init__(self, generators: list[CoverGenerator]):
        self.generators = generators

    async def generate(self, title: str, author: str) -> str | None:
        for gen in self.generators:
            result = await gen.generate(title, author)
            if result:
                return result
        return None


default_cover_service = CoverService([SvgCoverGenerator()])
