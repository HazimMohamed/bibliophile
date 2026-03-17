import React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';

function latestConversationPreview(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { roleLabel: null, text: 'No messages yet.' };
  }
  const latest = messages[messages.length - 1];
  const roleLabel = latest?.role === 'user' ? 'You' : 'AI';
  const raw = (latest?.content ?? '').trim();
  if (!raw) return { roleLabel, text: 'No message content.' };
  const text = raw.length > 160 ? `${raw.slice(0, 160)}...` : raw;
  return { roleLabel, text };
}

export default function AnnotationPanel({ annotations, rect, onDelete, onResumeConversation, onClose }) {
  const anchorX = rect.left;
  const anchorY = rect.top + rect.height;

  return (
    <PopoverPrimitive.Root open onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }} modal={false}>
      <PopoverPrimitive.Trigger asChild>
        <span
          aria-hidden="true"
          style={{
            position: 'fixed',
            left: anchorX,
            top: anchorY,
            width: 1,
            height: 1,
            pointerEvents: 'none',
          }}
        />
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          className="ann-panel"
          side="bottom"
          align="start"
          sideOffset={8}
          collisionPadding={8}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
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
                {ann.type === 'conversation' && (
                  <div className="ann-conv-preview">
                    <div className="ann-conv-meta">
                      <span>{Array.isArray(ann.messages) ? ann.messages.length : 0} messages</span>
                    </div>
                    {(() => {
                      const preview = latestConversationPreview(ann.messages);
                      return (
                        <p className="ann-conv-snippet">
                          {preview.roleLabel && <strong>{preview.roleLabel}: </strong>}
                          {preview.text}
                        </p>
                      );
                    })()}
                  </div>
                )}
                <div className="ann-item-footer">
                  <span className="ann-item-type">{ann.type}</span>
                  <div className="ann-item-actions">
                    {ann.type === 'conversation' && (
                      <button className="ann-item-resume" onClick={() => onResumeConversation?.(ann)}>
                        Resume
                      </button>
                    )}
                    <button className="ann-item-delete" onClick={() => onDelete(ann.id)}>
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
