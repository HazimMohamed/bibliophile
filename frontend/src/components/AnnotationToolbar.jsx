import React from 'react';

export default function AnnotationToolbar({ rect, onHighlight, onNoteRequest, onClose }) {
  const top = Math.max(8, rect.top - 48);
  const left = rect.left + rect.width / 2;

  return (
    <div
      className="ann-toolbar"
      style={{ top, left }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="ann-toolbar-row">
        <button className="ann-btn highlight" onClick={onHighlight}>Highlight</button>
        <button className="ann-btn note" onClick={onNoteRequest}>Note</button>
      </div>
    </div>
  );
}
