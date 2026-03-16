import React, { useEffect } from 'react';
import { useFloating, offset, flip, shift } from '@floating-ui/react';

export default function ContextMenu({ point, items, onClose }) {
  const { refs, floatingStyles } = useFloating({
    strategy: 'fixed',
    placement: 'bottom-start',
    middleware: [offset(2), flip(), shift({ padding: 8 })],
  });

  useEffect(() => {
    refs.setReference({
      getBoundingClientRect: () => ({
        x: point.x, y: point.y,
        top: point.y, left: point.x,
        bottom: point.y, right: point.x,
        width: 0, height: 0,
      }),
    });
  }, [point.x, point.y]);

  return (
    <div
      ref={refs.setFloating}
      className="context-menu"
      style={floatingStyles}
      onMouseDown={(e) => e.preventDefault()}
    >
      {items.map((item) => (
        <button
          key={item.label}
          className={`context-menu-item${item.variant ? ` context-menu-item--${item.variant}` : ''}`}
          onClick={() => { item.action(); onClose(); }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
