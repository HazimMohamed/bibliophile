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

  createConversation: (bookId, data) =>
    fetch(`/api/books/${bookId}/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then((r) => r.json()),

  getConversation: (bookId, annId) =>
    fetch(`/api/books/${bookId}/conversations/${encodeURIComponent(annId)}`).then((r) => r.json()),

  streamMessages: async (bookId, annId, content, onToken, onDone, onError) => {
    try {
      const res = await fetch(
        `/api/books/${bookId}/conversations/${encodeURIComponent(annId)}/messages`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let completed = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        let isError = false;
        for (const line of lines) {
          if (line.startsWith('event: error')) { isError = true; continue; }
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (isError) { onError?.(new Error(data)); return; }
            if (data === '[DONE]') { completed = true; onDone(); return; }
            onToken(data);
          }
          if (!line.trim()) isError = false;
        }
      }
      if (!completed) onError?.(new Error('Stream closed unexpectedly'));
    } catch (err) { onError?.(err); }
  },
};
