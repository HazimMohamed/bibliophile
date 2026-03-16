import React, { useEffect, useRef } from 'react';

function groupByPart(chapters) {
  const groups = [];
  let current = null;

  for (const ch of chapters) {
    const partKey = ch.part || null;
    if (!current || current.part !== partKey) {
      current = { part: partKey, chapters: [] };
      groups.push(current);
    }
    current.chapters.push(ch);
  }
  return groups;
}

export default function Outline({ chapters, currentChapterIndex, onNavigate, onClose }) {
  const panelRef = useRef(null);
  const activeRef = useRef(null);

  // Scroll active chapter into view when outline opens
  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ block: 'nearest' });
    }
  }, []);

  // Close on Escape
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const groups = groupByPart(chapters);

  return (
    <div className="outline-overlay" role="dialog" aria-modal="true" aria-label="Book outline">
      {/* Backdrop */}
      <div className="outline-backdrop" onClick={onClose} />

      {/* Panel */}
      <nav className="outline-panel" ref={panelRef}>
        <div className="outline-header">
          <a
            href="#/library"
            className="outline-library-link"
            onClick={onClose}
          >
            ← Library
          </a>
          <button className="outline-close-btn" onClick={onClose} aria-label="Close outline">
            ✕
          </button>
        </div>

        <div className="outline-scroll">
          {groups.map((group, gi) => (
            <div key={gi} className="outline-group">
              {group.part && (
                <div className="outline-part-label">{group.part}</div>
              )}
              {group.chapters.map((ch) => {
                const isActive = ch.index === currentChapterIndex;
                return (
                  <button
                    key={ch.index}
                    ref={isActive ? activeRef : null}
                    className={'outline-chapter-btn' + (isActive ? ' active' : '')}
                    onClick={() => { onNavigate(ch.index); onClose(); }}
                  >
                    {ch.title}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </nav>
    </div>
  );
}
