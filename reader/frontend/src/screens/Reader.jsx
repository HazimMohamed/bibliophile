import React, { useEffect, useState, useRef, useCallback } from 'react';
import { api } from '../api.js';
import Outline from '../components/Outline.jsx';
import AnnotationToolbar from '../components/AnnotationToolbar.jsx';
import AnnotationPanel from '../components/AnnotationPanel.jsx';
import NoteModal from '../components/NoteModal.jsx';

const SAMPLE_INTERVAL_MS = 500;
const SAVE_DEBOUNCE_MS = 2000;

function renderWithHighlights(text, highlights) {
  // Resolve offsets: use stored offsets or fall back to indexOf
  const resolved = highlights
    .map((h) => {
      let start = h.start_offset;
      let end = h.end_offset;
      if (start == null && h.selected_text) {
        start = text.indexOf(h.selected_text);
        end = start === -1 ? null : start + h.selected_text.length;
      }
      return start != null && end != null && start < end ? { ...h, start_offset: start, end_offset: end } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.start_offset - b.start_offset);

  if (resolved.length === 0) return text;

  const parts = [];
  let pos = 0;
  for (const h of resolved) {
    const start = Math.max(h.start_offset, pos);
    const end = Math.min(h.end_offset, text.length);
    if (start >= end) continue;
    if (start > pos) parts.push(text.slice(pos, start));
    parts.push(<mark key={h.id} className="inline-highlight">{text.slice(start, end)}</mark>);
    pos = end;
  }
  if (pos < text.length) parts.push(text.slice(pos));
  return parts;
}

function buildAnnotationMap(annotations, forChapter) {
  const map = new Map();
  if (!Array.isArray(annotations)) return map;
  for (const ann of annotations) {
    if (ann.chapter_index === forChapter) {
      const idx = ann.paragraph_index;
      if (!map.has(idx)) map.set(idx, []);
      map.get(idx).push(ann);
    }
  }
  return map;
}

export default function Reader({ bookId }) {
  const [book, setBook] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [chapterIndex, setChapterIndex] = useState(0);
  const [outlineOpen, setOutlineOpen] = useState(false);

  // All annotations for this book; kept in sync on create/delete
  const [allAnnotations, setAllAnnotations] = useState([]);
  // Map<paragraphIndex, Annotation[]> for the current chapter
  const [annotationMap, setAnnotationMap] = useState(new Map());

  // Debug: paragraph currently at the viewport midpoint
  const [currentParaIdx, setCurrentParaIdx] = useState(null);

  // Floating toolbar after text selection
  const [selectionInfo, setSelectionInfo] = useState(null);
  // Note modal — holds the selection info while the user types their note
  const [noteModalInfo, setNoteModalInfo] = useState(null);
  // Annotation detail panel
  const [activePanel, setActivePanel] = useState(null); // { annotations, rect }

  const lastSavedChapter = useRef(0);
  const lastSavedParagraph = useRef(0);
  const lastSaveTime = useRef(0);
  const sampleTimerRef = useRef(null);

  // ── Load book ────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [bookData, annotations] = await Promise.all([
          api.getBook(bookId),
          api.listAnnotations(bookId).catch(() => []),
        ]);
        if (cancelled) return;
        setBook(bookData);
        const startChapter = bookData.current_chapter_index ?? 0;
        setChapterIndex(startChapter);
        lastSavedChapter.current = startChapter;
        lastSavedParagraph.current = bookData.semantic_paragraph_index ?? 0;
        setAllAnnotations(annotations);
        setAnnotationMap(buildAnnotationMap(annotations, startChapter));
      } catch (err) {
        if (!cancelled) { setError('Could not load book.'); console.error(err); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [bookId]);

  // Rebuild map whenever annotations or chapter changes
  useEffect(() => {
    setAnnotationMap(buildAnnotationMap(allAnnotations, chapterIndex));
    setActivePanel(null);
    setSelectionInfo(null);
  }, [allAnnotations, chapterIndex]);

  // ── Scroll to saved position ─────────────────────────────

  useEffect(() => {
    if (!book || loading) return;
    const savedPara = lastSavedParagraph.current;
    if (savedPara <= 0) { window.scrollTo({ top: 0, behavior: 'instant' }); return; }
    requestAnimationFrame(() => {
      const el = document.querySelector(`p[data-paragraph="${savedPara}"]`);
      if (el) el.scrollIntoView({ behavior: 'instant', block: 'center' });
    });
  }, [book, loading, chapterIndex]);

  // ── Reading position sampling ────────────────────────────

  const samplePosition = useCallback(() => {
    const midY = window.innerHeight / 2;
    for (const p of document.querySelectorAll('p[data-paragraph]')) {
      const rect = p.getBoundingClientRect();
      if (rect.top <= midY && rect.bottom >= midY) return parseInt(p.dataset.paragraph, 10);
    }
    return null;
  }, []);

  const maybeSavePosition = useCallback((paragraphIndex) => {
    if (paragraphIndex === null || paragraphIndex === undefined) return;
    const now = Date.now();
    const sameChapter = chapterIndex === lastSavedChapter.current;
    const advanced = sameChapter
      ? paragraphIndex > lastSavedParagraph.current
      : chapterIndex > lastSavedChapter.current;
    if (!advanced) return;
    if (now - lastSaveTime.current < SAVE_DEBOUNCE_MS) return;
    lastSavedChapter.current = chapterIndex;
    lastSavedParagraph.current = paragraphIndex;
    lastSaveTime.current = now;
    api.updateState(bookId, {
      current_chapter_index: chapterIndex,
      semantic_paragraph_index: paragraphIndex,
    }).catch(console.error);
  }, [bookId, chapterIndex]);

  useEffect(() => {
    if (!book) return;
    clearInterval(sampleTimerRef.current);
    sampleTimerRef.current = setInterval(() => {
      const idx = samplePosition();
      setCurrentParaIdx(idx);
      maybeSavePosition(idx);
    }, SAMPLE_INTERVAL_MS);
    return () => clearInterval(sampleTimerRef.current);
  }, [book, chapterIndex, samplePosition, maybeSavePosition]);

  // ── Text selection ───────────────────────────────────────

  const dismissSelection = useCallback(() => {
    setSelectionInfo(null);
    window.getSelection()?.removeAllRanges();
  }, []);

  useEffect(() => {
    const onMouseUp = () => {
      setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.toString().trim()) {
          setSelectionInfo(null);
          return;
        }
        // Walk up from anchor node to find the <p data-paragraph="N">
        let node = sel.anchorNode;
        while (node && !(node.nodeName === 'P' && node.dataset?.paragraph !== undefined)) {
          node = node.parentNode;
        }
        if (!node) { setSelectionInfo(null); return; }

        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();

        // Character offsets within the paragraph text node
        const nodeRange = document.createRange();
        nodeRange.selectNodeContents(node);
        nodeRange.setEnd(range.startContainer, range.startOffset);
        const startOffset = nodeRange.toString().length;
        const endOffset = startOffset + range.toString().length;

        setSelectionInfo({
          rect,
          text: sel.toString().trim(),
          paragraphIndex: parseInt(node.dataset.paragraph, 10),
          startOffset,
          endOffset,
        });
        setActivePanel(null);
      }, 10);
    };

    window.addEventListener('mouseup', onMouseUp);
    return () => window.removeEventListener('mouseup', onMouseUp);
  }, []);

  // ── Annotation CRUD ──────────────────────────────────────

  const currentChapter = book?.chapters?.[chapterIndex] ?? null;

  const handleHighlight = useCallback(async () => {
    if (!selectionInfo || !currentChapter) return;
    dismissSelection();
    try {
      const ann = await api.createHighlight(bookId, {
        chapter_id: currentChapter.id,
        chapter_index: chapterIndex,
        paragraph_index: selectionInfo.paragraphIndex,
        selected_text: selectionInfo.text,
        start_offset: selectionInfo.startOffset,
        end_offset: selectionInfo.endOffset,
      });
      setAllAnnotations((prev) => [...prev, ann]);
    } catch (err) { console.error(err); }
  }, [selectionInfo, currentChapter, bookId, chapterIndex, dismissSelection]);

  const handleNoteRequest = useCallback(() => {
    if (!selectionInfo) return;
    setNoteModalInfo(selectionInfo);
    dismissSelection();
  }, [selectionInfo, dismissSelection]);

  const handleNoteSave = useCallback(async (content) => {
    if (!noteModalInfo || !currentChapter) return;
    setNoteModalInfo(null);
    try {
      const ann = await api.createNote(bookId, {
        chapter_id: currentChapter.id,
        chapter_index: chapterIndex,
        paragraph_index: noteModalInfo.paragraphIndex,
        content,
      });
      setAllAnnotations((prev) => [...prev, ann]);
    } catch (err) { console.error(err); }
  }, [noteModalInfo, currentChapter, bookId, chapterIndex]);

  const handleDelete = useCallback(async (annId) => {
    try {
      await api.deleteAnnotation(bookId, annId);
      setAllAnnotations((prev) => prev.filter((a) => a.id !== annId));
    } catch (err) { console.error(err); }
  }, [bookId]);

  // ── Chapter navigation ───────────────────────────────────

  const chapters = book?.chapters ?? [];
  const totalChapters = chapters.length;

  const goToChapter = useCallback((newIdx) => {
    if (!book || newIdx < 0 || newIdx >= totalChapters) return;
    lastSavedChapter.current = newIdx;
    lastSavedParagraph.current = 0;
    lastSaveTime.current = Date.now();
    api.updateState(bookId, {
      current_chapter_index: newIdx,
      semantic_paragraph_index: 0,
    }).catch(console.error);
    window.scrollTo({ top: 0, behavior: 'instant' });
    setChapterIndex(newIdx);
  }, [book, bookId, totalChapters]);

  const chapterLabel = book
    ? `${book.title} — Ch ${chapterIndex + 1} of ${totalChapters}`
    : 'Loading…';

  // ── Global dismiss on outside click ─────────────────────

  const handleRootClick = useCallback((e) => {
    if (!e.target.closest('.ann-toolbar')) {
      // Only clear the toolbar on a plain click (collapsed selection).
      // If the user just finished a drag-select, the selection is still active
      // here — leave it alone so the mouseup handler can set selectionInfo.
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) setSelectionInfo(null);
    }
    if (!e.target.closest('.ann-panel') && !e.target.closest('[data-paragraph]')) {
      setActivePanel(null);
    }
  }, []);

  // ── Render ───────────────────────────────────────────────

  if (loading) {
    return (
      <div className="reader-root">
        <div className="reader-header">
          <button className="reader-outline-btn" disabled>☰</button>
          <span className="reader-chapter-label">Loading…</span>
          <div className="reader-header-spacer" />
        </div>
        <div className="reader-scroll-area">
          <p className="state-msg">Loading book…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="reader-root">
        <div className="reader-header">
          <button className="reader-outline-btn" onClick={() => window.location.hash = '#/library'}>☰</button>
          <span className="reader-chapter-label">Error</span>
          <div className="reader-header-spacer" />
        </div>
        <div className="reader-scroll-area">
          <p className="state-msg error">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="reader-root" onClick={handleRootClick}>
      {outlineOpen && (
        <Outline
          chapters={chapters}
          currentChapterIndex={chapterIndex}
          onNavigate={goToChapter}
          onClose={() => setOutlineOpen(false)}
        />
      )}

      {selectionInfo && (
        <AnnotationToolbar
          rect={selectionInfo.rect}
          onHighlight={handleHighlight}
          onNoteRequest={handleNoteRequest}
          onClose={dismissSelection}
        />
      )}

      {noteModalInfo && (
        <NoteModal
          selectedText={noteModalInfo.text}
          onSave={handleNoteSave}
          onClose={() => setNoteModalInfo(null)}
        />
      )}

      {activePanel && (
        <AnnotationPanel
          annotations={activePanel.annotations}
          rect={activePanel.rect}
          onDelete={handleDelete}
          onClose={() => setActivePanel(null)}
        />
      )}

      <header className="reader-header">
        <button
          className="reader-outline-btn"
          onClick={(e) => { e.stopPropagation(); setOutlineOpen(true); }}
          aria-label="Open outline"
        >
          ☰
        </button>
        <span className="reader-chapter-label">{chapterLabel}</span>
        <div className="reader-header-spacer" />
      </header>

      <div className="reader-scroll-area">
        <div className="reader-chapter-content">
          {currentChapter?.title && (
            <h2 className="reader-chapter-title">{currentChapter.title}</h2>
          )}

          {(currentChapter?.paragraphs ?? []).map((text, i) => {
            const anns = annotationMap.get(i);
            const highlights = anns?.filter((a) => a.type === 'highlight') ?? [];
            const hasNote = anns?.some((a) => a.type === 'note');
            const cls = [
              'reader-paragraph',
              hasNote ? 'has-note' : '',
              i === currentParaIdx ? 'is-current-pos' : '',
            ].filter(Boolean).join(' ');

            return (
              <p
                key={i}
                data-paragraph={i}
                className={cls}
                onClick={anns?.length ? (e) => {
                  e.stopPropagation();
                  dismissSelection();
                  setActivePanel({ annotations: anns, rect: e.currentTarget.getBoundingClientRect() });
                } : undefined}
              >
                {highlights.length > 0 ? renderWithHighlights(text, highlights) : text}
              </p>
            );
          })}

          {(!currentChapter || (currentChapter.paragraphs ?? []).length === 0) && (
            <p className="state-msg">No content in this chapter.</p>
          )}
        </div>
      </div>

      <footer className="reader-footer">
        <button
          className="reader-nav-btn"
          onClick={() => goToChapter(chapterIndex - 1)}
          disabled={chapterIndex === 0}
        >
          ◀ prev chapter
        </button>
        <button
          className="reader-nav-btn"
          onClick={() => goToChapter(chapterIndex + 1)}
          disabled={chapterIndex >= totalChapters - 1}
        >
          next chapter ▶
        </button>
      </footer>
    </div>
  );
}
