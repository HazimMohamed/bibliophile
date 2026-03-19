import { Capacitor } from '@capacitor/core';

const isNativeApp = Capacitor.isNativePlatform();

async function ensureOk(response) {
  if (response.ok) {
    return response;
  }

  let details = '';
  try {
    details = await response.text();
  } catch {
    details = '';
  }

  const suffix = details ? ` ${details.slice(0, 200)}` : '';
  throw new Error(`HTTP ${response.status}${suffix}`);
}

export async function requestJson(url, options) {
  const response = await fetch(url, options);
  await ensureOk(response);
  return response.json();
}

export async function requestText(url, options) {
  const response = await fetch(url, options);
  await ensureOk(response);
  return response.text();
}

export async function requestVoid(url, options) {
  const response = await fetch(url, options);
  await ensureOk(response);
}

function processSseLines(chunk, onToken, onDone, onError, state) {
  state.buffer += chunk;
  const lines = state.buffer.split('\n');
  state.buffer = lines.pop() ?? '';
  let isError = false;

  for (const line of lines) {
    if (line.startsWith('event: error')) {
      isError = true;
      continue;
    }
    if (line.startsWith('data: ')) {
      const data = line.slice(6);
      if (isError) {
        onError?.(new Error(data));
        state.failed = true;
        return;
      }
      if (data === '[DONE]') {
        state.completed = true;
        onDone?.();
        return;
      }
      onToken?.(data);
    }
    if (!line.trim()) {
      isError = false;
    }
  }
}

export async function requestEventStream(url, options, { onToken, onDone, onError }) {
  try {
    const response = await fetch(url, options);
    await ensureOk(response);

    const state = {
      buffer: '',
      completed: false,
      failed: false,
    };

    // Native Capacitor HTTP patches fetch to return a completed Response.
    // We still parse the SSE payload so functionality survives, even if the
    // token stream arrives all at once instead of live.
    if (isNativeApp || !response.body?.getReader) {
      const text = await response.text();
      processSseLines(text, onToken, onDone, onError, state);
      if (!state.completed && !state.failed) {
        onError?.(new Error('Stream closed unexpectedly'));
      }
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      processSseLines(decoder.decode(value, { stream: true }), onToken, onDone, onError, state);
      if (state.completed || state.failed) {
        return;
      }
    }

    processSseLines(decoder.decode(), onToken, onDone, onError, state);
    if (!state.completed && !state.failed) {
      onError?.(new Error('Stream closed unexpectedly'));
    }
  } catch (error) {
    onError?.(error);
  }
}

export function isNativeTransport() {
  return isNativeApp;
}
