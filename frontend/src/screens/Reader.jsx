import React, { useEffect, useState, useRef, useCallback } from 'react';
import { api } from '../api.js';
import Outline from '../components/Outline.jsx';
import AnnotationToolbar from '../components/AnnotationToolbar.jsx';
import AnnotationPanel from '../components/AnnotationPanel.jsx';
import NoteModal from '../components/NoteModal.jsx';
import ChatPanel from '../components/ChatPanel.jsx';
import ReaderSettingsModal from '../components/ReaderSettingsModal.jsx';

const SAMPLE_INTERVAL_MS = 500;
const SAVE_DEBOUNCE_MS = 2000;
const READER_SETTINGS_KEY = 'bibliophile.reader.settings.v1';

const DEFAULT_READER_SETTINGS = {
  fontFamily: 'serif',
  fontSizePx: 18,
  lineHeight: 1.8,
  theme: 'warm',
  contentMaxWidthPx: 680,
};

const THEME_PRESETS = {
  warm: {
    '--color-bg': '#f8f3ea',
    '--color-surface': '#ece3d2',
    '--color-surface-panel': '#f2e9da',
    '--color-surface-modal': '#f7efe2',
    '--color-text': '#1c1712',
    '--color-text-muted': '#8f8577',
    '--color-border': 'rgba(40, 30, 20, 0.12)',
    '--color-border-soft': 'rgba(40, 30, 20, 0.08)',
    '--color-hover-soft': 'rgba(40, 30, 20, 0.06)',
  },
  darkWarm: {
    '--color-bg': '#1f1a16',
    '--color-surface': '#2a231e',
    '--color-surface-panel': '#241e19',
    '--color-surface-modal': '#302822',
    '--color-text': '#f1e6d9',
    '--color-text-muted': '#c5b29f',
    '--color-border': 'rgba(241, 230, 217, 0.18)',
    '--color-border-soft': 'rgba(241, 230, 217, 0.12)',
    '--color-hover-soft': 'rgba(241, 230, 217, 0.1)',
  },
  highContrast: {
    '--color-bg': '#ffffff',
    '--color-surface': '#f3f3f3',
    '--color-surface-panel': '#ffffff',
    '--color-surface-modal': '#ffffff',
    '--color-text': '#0b0b0b',
    '--color-text-muted': '#353535',
    '--color-border': 'rgba(0, 0, 0, 0.24)',
    '--color-border-soft': 'rgba(0, 0, 0, 0.16)',
    '--color-hover-soft': 'rgba(0, 0, 0, 0.12)',
  },
  mist: {
    '--color-bg': '#edf1f5',
    '--color-surface': '#dde5ee',
    '--color-surface-panel': '#e6edf4',
    '--color-surface-modal': '#ecf2f8',
    '--color-text': '#1a2530',
    '--color-text-muted': '#617181',
    '--color-border': 'rgba(20, 34, 48, 0.14)',
    '--color-border-soft': 'rgba(20, 34, 48, 0.09)',
    '--color-hover-soft': 'rgba(20, 34, 48, 0.07)',
  },
  nocturne: {
    '--color-bg': '#1a1e24',
    '--color-surface': '#232933',
    '--color-surface-panel': '#1f252e',
    '--color-surface-modal': '#262d37',
    '--color-text': '#edf1f6',
    '--color-text-muted': '#a8b5c3',
    '--color-border': 'rgba(237, 241, 246, 0.16)',
    '--color-border-soft': 'rgba(237, 241, 246, 0.1)',
    '--color-hover-soft': 'rgba(237, 241, 246, 0.1)',
  },
};

const FONT_FAMILY_MAP = {
  serif: "Georgia, 'Times New Roman', serif",
  literata: "'Literata', Georgia, serif",
  lora: "'Lora', Georgia, serif",
  merriweather: "'Merriweather', Georgia, serif",
  sourceSerif: "'Source Serif 4', Georgia, serif",
  crimson: "'Crimson Pro', Georgia, serif",
  inter: "'Inter', 'Segoe UI', sans-serif",
  sourceSans: "'Source Sans 3', 'Segoe UI', sans-serif",
};

function renderWithHighlights(text, highlights, paragraphIndex) {
  const resolved = highlights
    .filter(h => h.start && h.end)
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
  // Overlapping annotations of different types need a richer segmentation model.
  // For now we render in start-order and let later overlaps yield to earlier spans.
  for (const h of resolved) {
    const start = Math.max(h._s, pos);
    const end = Math.min(h._e, text.length);
    if (start >= end) continue;
    if (start > pos) parts.push(text.slice(pos, start));
    parts.push(<mark key={h.id} data-ann-id={h.id} className={`inline-highlight inline-highlight--${h.type}`}>{text.slice(start, end)}</mark>);
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
    if (ann.start && ann.end) {
      if (ann.start.chapter_index !== forChapter) continue;
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

function loadReaderSettings() {
  try {
    const raw = localStorage.getItem(READER_SETTINGS_KEY);
    if (!raw) return DEFAULT_READER_SETTINGS;
    const parsed = JSON.parse(raw);
    const nextTheme = parsed?.theme === 'paper'
      ? 'highContrast'
      : parsed?.theme === 'sepia'
        ? 'darkWarm'
        : parsed?.theme;
    return {
      ...DEFAULT_READER_SETTINGS,
      ...(parsed && typeof parsed === 'object' ? parsed : {}),
      theme: nextTheme ?? DEFAULT_READER_SETTINGS.theme,
    };
  } catch {
    return DEFAULT_READER_SETTINGS;
  }
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
  // Active conversation for chat panel
  const [activeConversation, setActiveConversation] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [readerSettings, setReaderSettings] = useState(() => loadReaderSettings());

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

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(READER_SETTINGS_KEY, JSON.stringify(readerSettings));
      } catch {
        // no-op: localStorage can fail in privacy modes
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [readerSettings]);

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

  // Close annotation detail panel while scrolling so it doesn't float detached from text.
  useEffect(() => {
    if (!activePanel) return;
    const onScroll = () => setActivePanel(null);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [activePanel]);

  // Hide selection toolbar while scrolling so it never lags behind the text.
  useEffect(() => {
    if (!selectionInfo) return;
    const onScroll = () => dismissSelection();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [selectionInfo, dismissSelection]);

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
        start: { chapter_index: chapterIndex, paragraph_index: noteModalInfo.startParaIndex, offset: noteModalInfo.startOffset },
        end: { chapter_index: chapterIndex, paragraph_index: noteModalInfo.endParaIndex, offset: noteModalInfo.endOffset },
        selected_text: noteModalInfo.text,
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
        start: { chapter_index: chapterIndex, paragraph_index: selectionInfo.startParaIndex, offset: selectionInfo.startOffset },
        end:   { chapter_index: chapterIndex, paragraph_index: selectionInfo.endParaIndex,   offset: selectionInfo.endOffset   },
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

  const applyConversationUpdate = useCallback((updatedConversation) => {
    if (!updatedConversation?.id) return;
    setActiveConversation((prev) => (prev?.id === updatedConversation.id ? updatedConversation : prev));
    setAllAnnotations((prev) =>
      prev.map((ann) => (ann.id === updatedConversation.id ? { ...ann, ...updatedConversation } : ann))
    );
  }, []);

  const closeConversation = useCallback(async () => {
    const conv = activeConversation;
    setActiveConversation(null);
    if (!conv?.id) return;
    try {
      const fresh = await api.getConversation(bookId, conv.id);
      applyConversationUpdate(fresh);
    } catch (err) {
      console.error(err);
    }
  }, [activeConversation, bookId, applyConversationUpdate]);

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

  const themeVars = THEME_PRESETS[readerSettings.theme] ?? THEME_PRESETS.warm;
  const readerVars = {
    ...themeVars,
    '--reader-font-family': FONT_FAMILY_MAP[readerSettings.fontFamily] ?? FONT_FAMILY_MAP.serif,
    '--reader-font-size': `${readerSettings.fontSizePx}px`,
    '--reader-line-height': String(readerSettings.lineHeight),
    '--reader-content-max-width': `${readerSettings.contentMaxWidthPx}px`,
  };

  // ── Global dismiss on outside click ─────────────────────

  const handleRootClick = useCallback((e) => {
    if (!e.target.closest('.ann-toolbar')) {
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
    <div className={`reader-root${activeConversation ? ' chat-open' : ''}`} style={readerVars} onClick={handleRootClick}>
      {outlineOpen && (
        <Outline
          chapters={chapters}
          currentChapterIndex={chapterIndex}
          onNavigate={goToChapter}
          onClose={() => setOutlineOpen(false)}
        />
      )}

      <AnnotationToolbar
        open={Boolean(selectionInfo)}
        rect={selectionInfo?.rect ?? null}
        onHighlight={handleHighlight}
        onNoteRequest={handleNoteRequest}
        onDiscuss={handleDiscuss}
      />

      {noteModalInfo && (
        <NoteModal
          selectedText={noteModalInfo.text}
          onSave={handleNoteSave}
          onClose={() => setNoteModalInfo(null)}
        />
      )}

      {settingsOpen && (
        <ReaderSettingsModal
          settings={readerSettings}
          onChange={(patch) => setReaderSettings((prev) => ({ ...prev, ...patch }))}
          onReset={() => setReaderSettings(DEFAULT_READER_SETTINGS)}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {activePanel && (
        <AnnotationPanel
          annotations={activePanel.annotations}
          rect={activePanel.rect}
          onDelete={handleDelete}
          onResumeConversation={(ann) => {
            setActivePanel(null);
            setActiveConversation(ann);
          }}
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
        <button
          className="reader-settings-btn"
          onClick={(e) => { e.stopPropagation(); setSettingsOpen(true); }}
          aria-label="Open reader settings"
          title="Reader settings"
        >
          ⚙
        </button>
      </header>

      <div className="reader-scroll-area">
        <div className="reader-chapter-content">
          {currentChapter?.title && (
            <h2 className="reader-chapter-title">{currentChapter.title}</h2>
          )}

          {(currentChapter?.paragraphs ?? []).map((text, i) => {
            const anns = annotationMap.get(i);
            const inlineAnnotations = anns?.filter((a) => a.start && a.end) ?? [];
            const cls = [
              'reader-paragraph',
              i === currentParaIdx ? 'is-current-pos' : '',
            ].filter(Boolean).join(' ');

            return (
              <p
                key={i}
                data-paragraph={i}
                className={cls}
                onClick={anns?.length ? (e) => {
                  const sel = window.getSelection();
                  if (sel && !sel.isCollapsed && sel.toString().trim()) return; // user just selected text
                  const markEl = e.target.closest('mark.inline-highlight');
                  if (!markEl) return; // must click the highlighted span itself
                  const annId = markEl.dataset.annId;
                  if (!annId) return;
                  const clickedAnn = anns.find((ann) => ann.id === annId);
                  if (!clickedAnn) return;
                  e.stopPropagation();
                  dismissSelection();
                  setActivePanel({ annotations: [clickedAnn], rect: markEl.getBoundingClientRect() });
                } : undefined}
              >
                {inlineAnnotations.length > 0 ? renderWithHighlights(text, inlineAnnotations, i) : text}
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
          onConversationUpdate={applyConversationUpdate}
          onClose={closeConversation}
        />
      )}
    </div>
  );
}
