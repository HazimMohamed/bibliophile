import React, { useEffect, useState, useCallback } from 'react';
import { api, getRuntimeApiBase } from '../api.js';
import ConnectionLab from '../components/ConnectionLab.jsx';
import { requestText } from '../transport.js';
import UploadButton from '../components/UploadButton.jsx';

function getInitials(title) {
  if (!title) return '?';
  return title
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

function BookTile({ book, onClick }) {
  const { title, author, cover_base64, reading_position, chapter_count } = book;
  const chapterIndex = reading_position?.chapter_index ?? 0;

  const showProgress =
    typeof chapter_count === 'number' &&
    chapter_count > 0 &&
    chapterIndex > 0;

  const progressPct = showProgress
    ? Math.min(100, (chapterIndex / (chapter_count - 1)) * 100)
    : 0;

  return (
    <div className="book-tile" onClick={onClick} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}>
      <div className="book-cover-wrapper">
        {cover_base64 ? (
          <img
            className="book-cover-img"
            src={cover_base64}
            alt={`Cover of ${title}`}
          />
        ) : (
          <div className="book-cover-placeholder">{getInitials(title)}</div>
        )}
        {showProgress && (
          <div className="book-progress-bar-track">
            <div className="book-progress-bar-fill" style={{ width: `${progressPct}%` }} />
          </div>
        )}
      </div>
      <div className="book-meta">
        <div className="book-meta-title" title={title}>{title || 'Untitled'}</div>
        {author && <div className="book-meta-author" title={author}>{author}</div>}
      </div>
    </div>
  );
}

export default function Library() {
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [probeResults, setProbeResults] = useState({});
  const [busyProbeKey, setBusyProbeKey] = useState(null);

  // Keep the connection lab around for future network debugging, but hide it
  // from normal builds unless we explicitly opt in.
  const showConnectionLab = import.meta.env.VITE_SHOW_CONNECTION_LAB === 'true';
  const runtimeApiBase = getRuntimeApiBase();
  const emulatorProbeUrl = 'http://10.0.2.2:8787/ping';
  const publicProbeUrl = 'https://httpbingo.org/get?source=bibliophile-android';
  const apiProbeUrl = `${runtimeApiBase}/books`;
  const probes = [
    {
      key: 'host',
      tabLabel: 'Host',
      title: 'Host bridge',
      actionLabel: 'Test Host',
      tone: 'host',
      url: emulatorProbeUrl,
    },
    {
      key: 'public',
      tabLabel: 'Public',
      title: 'Public HTTPS',
      actionLabel: 'Test Public',
      tone: 'public',
      url: publicProbeUrl,
    },
    {
      key: 'api',
      tabLabel: 'API',
      title: 'Runtime API',
      actionLabel: 'Test API',
      tone: 'api',
      url: apiProbeUrl,
    },
  ];

  const loadBooks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.listBooks();
      setBooks(Array.isArray(data) ? data : []);
    } catch (err) {
      setError('Could not load library.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBooks();
  }, [loadBooks]);

  const filtered = books.filter((b) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      b.title?.toLowerCase().includes(q) ||
      b.author?.toLowerCase().includes(q)
    );
  });

  const navigateToBook = (id) => {
    window.location.hash = `#/reader/${id}`;
  };

  const runProbe = useCallback(async (probe) => {
    setBusyProbeKey(probe.key);
    setProbeResults((current) => ({
      ...current,
      [probe.key]: `${probe.title}: probing ${probe.url}`,
    }));

    try {
      const text = await requestText(probe.url, {
        method: 'GET',
        headers: { Accept: 'text/plain, application/json' },
      });
      const snippet = text.trim().slice(0, 160) || '(empty body)';
      setProbeResults((current) => ({
        ...current,
        [probe.key]: `${probe.title}: ok ${snippet}`,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setProbeResults((current) => ({
        ...current,
        [probe.key]: `${probe.title}: failed ${message}`,
      }));
    } finally {
      setBusyProbeKey(null);
    }
  }, []);

  return (
    <div className="library-root">
      <header className="library-header">
        <h1 className="library-title">Bibliophile</h1>
        <UploadButton onUploaded={loadBooks} />
      </header>

      <div className="library-body">
        <input
          className="search-input"
          type="search"
          placeholder="Search by title or author…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search books"
        />

        {showConnectionLab && (
          <ConnectionLab
            runtimeApiBase={runtimeApiBase}
            probes={probes}
            probeResults={probeResults}
            busyProbeKey={busyProbeKey}
            onRunProbe={runProbe}
          />
        )}

        {loading && <p className="state-msg">Library is loading…</p>}

        {!loading && error && <p className="state-msg error">{error}</p>}

        {!loading && !error && filtered.length === 0 && (
          <p className="state-msg">
            {books.length === 0
              ? 'No books yet. Upload an EPUB to get started.'
              : 'No books match your search.'}
          </p>
        )}

        {!loading && !error && filtered.length > 0 && (
          <div className="book-grid">
            {filtered.map((book) => (
              <BookTile
                key={book.id}
                book={book}
                onClick={() => navigateToBook(book.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
