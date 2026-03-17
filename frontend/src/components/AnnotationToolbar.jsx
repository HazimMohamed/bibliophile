import React, { useRef } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';

export default function AnnotationToolbar({ open, rect, onHighlight, onNoteRequest, onDiscuss }) {
  const lastRectRef = useRef(null);
  if (rect) lastRectRef.current = rect;
  const anchorRect = rect ?? lastRectRef.current;
  if (!anchorRect) return null;

  const anchorX = anchorRect.left + anchorRect.width / 2;
  const anchorY = anchorRect.top;

  return (
    <PopoverPrimitive.Root open={open} modal={false}>
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
          forceMount
          className="ann-toolbar"
          side="top"
          align="center"
          sideOffset={12}
          collisionPadding={8}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="ann-toolbar-row">
            <button className="ann-btn highlight" onClick={onHighlight}>Highlight</button>
            <button className="ann-btn note" onClick={onNoteRequest}>Note</button>
            <button className="ann-btn discuss" onClick={onDiscuss}>Discuss</button>
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
