import React, { useEffect, useState, useRef, useCallback } from 'react';
import { api } from '../api.js';
import Outline from '../components/Outline.jsx';
import AnnotationToolbar from '../components/AnnotationToolbar.jsx';
import AnnotationPanel from '../components/AnnotationPanel.jsx';
import NoteModal from '../components/NoteModal.jsx';
import ContextMenu from '../components/ContextMenu.jsx';
import ChatPanel from '../components/ChatPanel.jsx';

const SAMPLE_INTERVAL_MS = 500;
const SAVE_DEBOUNCE_MS = 2000;

function renderWithHighlights(text, highlights, paragraphIndex) {
  const resolved = highlights
    .filter(h => h.type === 'highlight')
    .map((h) => {
      const sp = h.start.paragraph_index, ep = h.end.paragraph_index;
      let s, e;
      if (paragraphIndex === sp && paragraphIndex === ep) { s = h.start.offset; e = h.end.offset; }
      else if (paragraphIndex === sp)                     { s = h.start.offset; e = text.length;  }
      else if (paragraphIndex === ep)                     { s = 0;              e = h.end.offset; }
      else                                               { s = 0;              e = text.length;  }
      return s < e ? { ...h, _s: s, _e: e } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a._s - b._s);

  if (resolved.length === 0) return text;

  const parts = [];
  let pos = 0;
  for (const h of resolved) {
    const start = Math.max(h._s, pos);
    const end = Math.min(h._e, text.length);
    if (start >= end) continue;
    if (start > pos) parts.push(text.slice(pos, start));
    parts.push(<mark key={h.id} data-ann-id={h.id} className="inline-highlight">{text.slice(start, end)}</mark>);
    pos = end;
  }
  if (pos < text.length) parts.push(text.slice(pos));
  return parts;
}

function computeSelectionInfo() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.toString().trim()) return null;
  const range = sel.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  const findPara = (n) => {
    while (n && !(n.nodeName === 'P' && n.dataset?.paragraph !== undefined)) n = n.parentNode;
    return n;
  };
  const startPara = findPara(range.startContainer);
  const endPara   = findPara(range.endContainer);
  if (!startPara) return null;
  const measureOffset = (para, container, containerOffset) => {
    const r = document.createRange();
    r.selectNodeContents(para);
    r.setEnd(container, containerOffset);
    return r.toString().length;
  };
  const startOffset = measureOffset(startPara, range.startContainer, range.startOffset);
  const endOffset   = endPara
    ? measureOffset(endPara, range.endContainer, range.endOffset)
    : startOffset + range.toString().length;
  const text = sel.toString().trim();
  if (!text) return null;
  return {
    rect,
    text,
    startParaIndex: parseInt(startPara.dataset.paragraph, 10),
    endParaIndex:   parseInt((endPara ?? startPara).dataset.paragraph, 10),
    startOffset,
    endOffset,
  };
}

function buildAnnotationMap(annotations, forChapter) {
  const map = new Map();
  if (!Array.isArray(annotations)) return map;
  for (const ann of annotations) {
    if (ann.type === 'highlight') {
      if (ann.start?.chapter_index !== forChapter) continue;
      for (let i = ann.start.paragraph_index; i <= ann.end.paragraph_index; i++) {
        if (!map.has(i)) map.set(i, []);
        map.get(i).push(ann);
      }
    } else {
      const pos = ann.position;
      if (pos?.chapter_index !== forChapter) continue;
      if (!map.has(pos.paragraph_index)) map.set(pos.paragraph_index, []);
      map.get(pos.paragraph_index).push(ann);
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
  // Right-click context menu
  const [contextMenuInfo, setContextMenuInfo] = useState(null); // { point: {x,y}, items: [] }
  // Active conversation for chat panel
  const [activeConversation, setActiveConversation] = useState(null);

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
        const pos = bookData.reading_position ?? { chapter_index: 0, paragraph_index: 0, offset: 0 };
        const startChapter = pos.chapter_index;
        setChapterIndex(startChapter);
        lastSavedChapter.current = startChapter;
        lastSavedParagraph.current = pos.paragraph_index;
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
      reading_position: { chapter_index: chapterIndex, paragraph_index: paragraphIndex, offset: 0 },
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

  // Close context menu on scroll
  useEffect(() => {
    if (!contextMenuInfo) return;
    const close = () => setContextMenuInfo(null);
    window.addEventListener('scroll', close, { passive: true });
    return () => window.removeEventListener('scroll', close);
  }, [contextMenuInfo]);

  // ── Text selection ───────────────────────────────────────

  const dismissSelection = useCallback(() => {
    setSelectionInfo(null);
    window.getSelection()?.removeAllRanges();
  }, []);

  useEffect(() => {
    const onMouseUp = (e) => {
      if (e.button !== 0) return; // ignore right-click mouseup; contextmenu handles that
      setTimeout(() => {
        const info = computeSelectionInfo();
        setSelectionInfo(info);
        if (info) setActivePanel(null);
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
        start: { chapter_index: chapterIndex, paragraph_index: selectionInfo.startParaIndex, offset: selectionInfo.startOffset },
        end:   { chapter_index: chapterIndex, paragraph_index: selectionInfo.endParaIndex,   offset: selectionInfo.endOffset   },
        selected_text: selectionInfo.text,
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
        position: { chapter_index: chapterIndex, paragraph_index: noteModalInfo.startParaIndex, offset: 0 },
        content,
      });
      setAllAnnotations((prev) => [...prev, ann]);
    } catch (err) { console.error(err); }
  }, [noteModalInfo, currentChapter, bookId, chapterIndex]);

  const handleDiscuss = useCallback(async () => {
    if (!selectionInfo || !currentChapter) return;
    dismissSelection();
    try {
      const conv = await api.createConversation(bookId, {
        chapter_id: currentChapter.id,
        position: { chapter_index: chapterIndex, paragraph_index: selectionInfo.startParaIndex, offset: selectionInfo.startOffset },
        selected_text: selectionInfo.text,
      });
      setActiveConversation(conv);
      setAllAnnotations((prev) => [...prev, conv]);
    } catch (err) { console.error(err); }
  }, [selectionInfo, currentChapter, bookId, chapterIndex, dismissSelection]);

  const handleDelete = useCallback(async (annId) => {
    try {
      await api.deleteAnnotation(bookId, annId);
      setAllAnnotations((prev) => prev.filter((a) => a.id !== annId));
    } catch (err) { console.error(err); }
  }, [bookId]);

  const handleContextMenu = useCallback((e) => {
    if (e.target.closest('.ann-toolbar, .ann-panel, .modal-backdrop, .context-menu, .chat-panel')) return;
    const items = [];

    // Compute selection fresh from DOM — contextmenu fires before the mouseup setTimeout,
    // so React state may not be updated yet.
    const liveSelection = computeSelectionInfo();
    if (liveSelection) {
      setSelectionInfo(liveSelection);
      items.push({ label: 'Highlight', variant: 'highlight', action: handleHighlight });
      items.push({ label: 'Note',      variant: 'note',      action: handleNoteRequest });
      items.push({ label: 'Discuss',   variant: 'discuss',   action: handleDiscuss });
    }

    const markEl = e.target.closest('[data-ann-id]');
    if (markEl) {
      const annId = markEl.dataset.annId;
      items.push({ label: 'Remove highlight', variant: 'delete', action: () => handleDelete(annId) });
    }

    if (items.length === 0) return;
    e.preventDefault();
    setContextMenuInfo({ point: { x: e.clientX, y: e.clientY }, items });
  }, [handleHighlight, handleNoteRequest, handleDiscuss, handleDelete]);

  // ── Chapter navigation ───────────────────────────────────

  const chapters = book?.chapters ?? [];
  const totalChapters = chapters.length;

  const goToChapter = useCallback((newIdx) => {
    if (!book || newIdx < 0 || newIdx >= totalChapters) return;
    lastSavedChapter.current = newIdx;
    lastSavedParagraph.current = 0;
    lastSaveTime.current = Date.now();
    api.updateState(bookId, {
      reading_position: { chapter_index: newIdx, paragraph_index: 0, offset: 0 },
    }).catch(console.error);
    window.scrollTo({ top: 0, behavior: 'instant' });
    setChapterIndex(newIdx);
  }, [book, bookId, totalChapters]);

  const chapterLabel = book
    ? `${book.title} — Ch ${chapterIndex + 1} of ${totalChapters}`
    : 'Loading…';

  // ── Global dismiss on outside click ─────────────────────

  const handleRootClick = useCallback((e) => {
    if (!e.target.closest('.ann-toolbar, .context-menu')) {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) setSelectionInfo(null);
    }
    if (!e.target.closest('.ann-panel') && !e.target.closest('[data-paragraph]')) {
      setActivePanel(null);
    }
    if (!e.target.closest('.context-menu')) {
      setContextMenuInfo(null);
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
    <div className={`reader-root${activeConversation ? ' chat-open' : ''}`} onClick={handleRootClick} onContextMenu={handleContextMenu}>
      {outlineOpen && (
        <Outline
          chapters={chapters}
          currentChapterIndex={chapterIndex}
          onNavigate={goToChapter}
          onClose={() => setOutlineOpen(false)}
        />
      )}

      {selectionInfo && !contextMenuInfo && (
        <AnnotationToolbar
          rect={selectionInfo.rect}
          onHighlight={handleHighlight}
          onNoteRequest={handleNoteRequest}
          onDiscuss={handleDiscuss}
          onClose={dismissSelection}
        />
      )}

      {contextMenuInfo && (
        <ContextMenu
          point={contextMenuInfo.point}
          items={contextMenuInfo.items}
          onClose={() => setContextMenuInfo(null)}
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
                {highlights.length > 0 ? renderWithHighlights(text, highlights, i) : text}
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

      {activeConversation && (
        <ChatPanel
          bookId={bookId}
          conversation={activeConversation}
          onClose={() => setActiveConversation(null)}
        />
      )}
    </div>
  );
}
