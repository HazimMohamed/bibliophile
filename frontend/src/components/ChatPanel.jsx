import React, { useEffect, useRef, useState, useCallback } from 'react';
import { api } from '../api.js';

export default function ChatPanel({ bookId, conversation, onClose, onConversationUpdate }) {
  const [messages, setMessages] = useState(conversation.messages ?? []);
  const [streamingText, setStreamingText] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const openingFired = useRef(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    setMessages(conversation.messages ?? []);
    setStreamingText('');
    setStreaming(false);
    setInput('');
    setErrorMsg('');
    openingFired.current = false;
  }, [conversation.id]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, streamingText]);

  const publishConversationUpdate = useCallback((nextMessages) => {
    onConversationUpdate?.({ ...conversation, messages: nextMessages });
  }, [conversation, onConversationUpdate]);

  const doStream = useCallback((content) => {
    setStreaming(true);
    setStreamingText('');
    setErrorMsg('');
    api.streamMessages(
      bookId,
      conversation.id,
      content,
      (token) => setStreamingText((t) => t + token),
      () => {
        setStreamingText((text) => {
          setMessages((prev) => {
            const next = [...prev, { role: 'assistant', content: text }];
            publishConversationUpdate(next);
            return next;
          });
          return '';
        });
        setStreaming(false);
        setTimeout(() => inputRef.current?.focus(), 50);
      },
      (err) => {
        console.error(err);
        setStreaming(false);
        setErrorMsg('Something went wrong. Try again.');
      }
    );
  }, [bookId, conversation.id, publishConversationUpdate]);

  // Fire opening message if no messages yet — guard against Strict Mode double-invoke
  useEffect(() => {
    if (conversation.messages.length === 0 && !openingFired.current) {
      openingFired.current = true;
      doStream('');
    }
  }, [doStream]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSend = useCallback(() => {
    const content = input.trim();
    if (!content || streaming) return;
    setInput('');
    setMessages((prev) => {
      const next = [...prev, { role: 'user', content }];
      publishConversationUpdate(next);
      return next;
    });
    doStream(content);
  }, [input, streaming, doStream, publishConversationUpdate]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  return (
    <div className="chat-panel">
      <div className="chat-panel-header">
        <button className="chat-back-btn" onClick={onClose} aria-label="Close chat">
          ← Back
        </button>
        <span className="chat-panel-title">Reading companion</span>
      </div>

      {conversation.selected_text && (
        <blockquote className="chat-seed-quote">
          {conversation.selected_text.length > 200
            ? conversation.selected_text.slice(0, 200) + '…'
            : conversation.selected_text}
        </blockquote>
      )}

      <div className="chat-messages">
        {messages.map((msg, i) => (
          <div key={i} className={`chat-message chat-message--${msg.role}`}>
            {msg.content}
          </div>
        ))}
        {streaming && (
          <div className="chat-message chat-message--assistant">
            {streamingText}<span className="chat-cursor">▍</span>
          </div>
        )}
        {errorMsg && (
          <div className="chat-error">{errorMsg}</div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-area">
        <textarea
          ref={inputRef}
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Say something…"
          rows={1}
          disabled={streaming}
        />
        <button
          className="chat-send-btn"
          onClick={handleSend}
          disabled={!input.trim() || streaming}
        >
          Send
        </button>
      </div>
    </div>
  );
}
