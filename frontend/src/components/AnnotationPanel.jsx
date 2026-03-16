import React from 'react';

export default function AnnotationPanel({ annotations, rect, onDelete, onClose }) {
  const top = Math.min(rect.bottom + 8, window.innerHeight - 220);
  const left = Math.max(24, Math.min(rect.left, window.innerWidth - 320));

  return (
    <div
      className="ann-panel"
      style={{ top, left }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="ann-panel-header">
        <span className="ann-panel-count">
          {annotations.length} annotation{annotations.length !== 1 ? 's' : ''}
        </span>
        <button className="ann-panel-close" onClick={onClose}>✕</button>
      </div>
      <div className="ann-panel-list">
        {annotations.map((ann) => (
          <div key={ann.id} className={`ann-item ann-item--${ann.type}`}>
            {ann.selected_text && (
              <blockquote className="ann-item-quote">"{ann.selected_text}"</blockquote>
            )}
            {ann.content && <p className="ann-item-content">{ann.content}</p>}
            <div className="ann-item-footer">
              <span className="ann-item-type">{ann.type}</span>
              <button className="ann-item-delete" onClick={() => onDelete(ann.id)}>
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
