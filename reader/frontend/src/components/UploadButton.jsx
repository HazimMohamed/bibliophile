import React, { useRef, useState } from 'react';
import { api } from '../api.js';

export default function UploadButton({ onUploaded }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  const handleClick = () => {
    if (uploading) return;
    setError(null);
    inputRef.current.value = '';
    inputRef.current.click();
  };

  const handleChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);

    try {
      await api.uploadEpub(file);
      onUploaded?.();
    } catch (err) {
      setError('Upload failed');
      console.error('Upload error:', err);
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".epub"
        style={{ display: 'none' }}
        onChange={handleChange}
      />
      <button
        className="upload-btn"
        onClick={handleClick}
        disabled={uploading}
        title={error || 'Upload EPUB'}
      >
        {uploading ? (
          <>
            <span className="upload-spinner" />
            Uploading…
          </>
        ) : (
          <>
            <span style={{ fontSize: '1.1em', lineHeight: 1 }}>+</span>
            Add book
          </>
        )}
      </button>
    </>
  );
}
