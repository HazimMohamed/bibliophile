import { requestEventStream, requestJson, requestVoid } from './transport.js';

function buildApiUrl(path) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const apiBase = (import.meta.env.VITE_API_BASE_URL || '').trim();
  if (apiBase) {
    const trimmedBase = apiBase.replace(/\/+$/, '');
    return `${trimmedBase}${normalizedPath}`;
  }
  return `/api${normalizedPath}`;
}

export function getRuntimeApiBase() {
  const apiBase = (import.meta.env.VITE_API_BASE_URL || '').trim();
  return apiBase ? apiBase.replace(/\/+$/, '') : '/api';
}

export const api = {
  listBooks: () =>
    requestJson(buildApiUrl('/books')),

  getBook: (id) =>
    requestJson(buildApiUrl(`/books/${id}`)),

  uploadEpub: (file) => {
    const form = new FormData();
    form.append('file', file);
    return requestJson(buildApiUrl('/books/upload'), { method: 'POST', body: form });
  },

  updateState: (id, state) =>
    requestVoid(buildApiUrl(`/books/${id}/state`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
    }),

  listAnnotations: (id) =>
    requestJson(buildApiUrl(`/books/${id}/annotations`)),

  createHighlight: (bookId, data) =>
    requestJson(buildApiUrl(`/books/${bookId}/annotations/highlight`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),

  createNote: (bookId, data) =>
    requestJson(buildApiUrl(`/books/${bookId}/annotations/note`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),

  deleteAnnotation: (bookId, annId) =>
    requestVoid(buildApiUrl(`/books/${bookId}/annotations/${annId}`), { method: 'DELETE' }),

  createConversation: (bookId, { chapter_id, start, end, selected_text, title }) =>
    requestJson(buildApiUrl(`/books/${bookId}/conversations`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chapter_id, start, end, selected_text, title }),
    }),

  getConversation: (bookId, annId) =>
    requestJson(buildApiUrl(`/books/${bookId}/conversations/${encodeURIComponent(annId)}`)),

  streamMessages: async (bookId, annId, content, onToken, onDone, onError) => {
    return requestEventStream(
      buildApiUrl(`/books/${bookId}/conversations/${encodeURIComponent(annId)}/messages`),
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) },
      { onToken, onDone, onError }
    );
  },
};
