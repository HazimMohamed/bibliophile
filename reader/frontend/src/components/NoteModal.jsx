import React, { useState, useRef, useEffect } from 'react';

export default function NoteModal({ selectedText, onSave, onClose }) {
  const [content, setContent] = useState('');
  const textareaRef = useRef(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const handleSave = () => {
    if (content.trim()) onSave(content.trim());
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Add note</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        {selectedText && (
          <blockquote className="modal-quote">"{selectedText}"</blockquote>
        )}
        <textarea
          ref={textareaRef}
          className="modal-textarea"
          placeholder="Write your note…"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleSave();
          }}
          rows={5}
        />
        <div className="modal-actions">
          <button className="modal-btn secondary" onClick={onClose}>Cancel</button>
          <button className="modal-btn primary" onClick={handleSave} disabled={!content.trim()}>
            Save note
          </button>
        </div>
      </div>
    </div>
  );
}
