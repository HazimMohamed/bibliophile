import React, { useEffect } from 'react';

const FONT_OPTIONS = [
  { value: 'serif', label: 'System Serif' },
  { value: 'literata', label: 'Literata (Google)' },
  { value: 'lora', label: 'Lora (Google)' },
  { value: 'merriweather', label: 'Merriweather (Google)' },
  { value: 'sourceSerif', label: 'Source Serif 4 (Google)' },
  { value: 'crimson', label: 'Crimson Pro (Google)' },
  { value: 'inter', label: 'Inter (Google)' },
  { value: 'sourceSans', label: 'Source Sans 3 (Google)' },
];

const THEME_OPTIONS = [
  { value: 'warm', label: 'Warm' },
  { value: 'darkWarm', label: 'Dark Warm' },
  { value: 'highContrast', label: 'High Contrast' },
  { value: 'mist', label: 'Mist' },
  { value: 'nocturne', label: 'Nocturne' },
];

export default function ReaderSettingsModal({ settings, onChange, onReset, onClose }) {
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal reader-settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Reader Settings</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="reader-settings-grid">
          <label className="reader-settings-field">
            <span className="reader-settings-label">Font</span>
            <select
              className="reader-settings-select"
              value={settings.fontFamily}
              onChange={(e) => onChange({ fontFamily: e.target.value })}
            >
              {FONT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>

          <label className="reader-settings-field">
            <span className="reader-settings-label">Theme</span>
            <select
              className="reader-settings-select"
              value={settings.theme}
              onChange={(e) => onChange({ theme: e.target.value })}
            >
              {THEME_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>

          <label className="reader-settings-field">
            <span className="reader-settings-label">Font Size: {settings.fontSizePx}px</span>
            <input
              className="reader-settings-range"
              type="range"
              min={15}
              max={26}
              step={1}
              value={settings.fontSizePx}
              onChange={(e) => onChange({ fontSizePx: Number(e.target.value) })}
            />
          </label>

          <label className="reader-settings-field">
            <span className="reader-settings-label">Line Height: {settings.lineHeight.toFixed(2)}</span>
            <input
              className="reader-settings-range"
              type="range"
              min={1.4}
              max={2.2}
              step={0.05}
              value={settings.lineHeight}
              onChange={(e) => onChange({ lineHeight: Number(e.target.value) })}
            />
          </label>

          <label className="reader-settings-field">
            <span className="reader-settings-label">Paragraph Width: {settings.contentMaxWidthPx}px</span>
            <input
              className="reader-settings-range"
              type="range"
              min={520}
              max={920}
              step={10}
              value={settings.contentMaxWidthPx}
              onChange={(e) => onChange({ contentMaxWidthPx: Number(e.target.value) })}
            />
          </label>
        </div>

        <div className="modal-actions">
          <button className="modal-btn secondary" onClick={onReset}>Reset to defaults</button>
          <button className="modal-btn primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
