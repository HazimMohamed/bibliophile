export const api = {
  listBooks: () =>
    fetch('/api/books').then((r) => r.json()),

  getBook: (id) =>
    fetch(`/api/books/${id}`).then((r) => r.json()),

  uploadEpub: (file) => {
    const form = new FormData();
    form.append('file', file);
    return fetch('/api/books/upload', { method: 'POST', body: form }).then((r) => r.json());
  },

  updateState: (id, state) =>
    fetch(`/api/books/${id}/state`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
    }),

  listAnnotations: (id) =>
    fetch(`/api/books/${id}/annotations`).then((r) => r.json()),

  createHighlight: (bookId, data) =>
    fetch(`/api/books/${bookId}/annotations/highlight`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then((r) => r.json()),

  createNote: (bookId, data) =>
    fetch(`/api/books/${bookId}/annotations/note`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then((r) => r.json()),

  deleteAnnotation: (bookId, annId) =>
    fetch(`/api/books/${bookId}/annotations/${annId}`, { method: 'DELETE' }),
};
