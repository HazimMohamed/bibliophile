import React, { useEffect } from 'react';
import { useFloating, offset, flip, shift, autoUpdate } from '@floating-ui/react';

export default function AnnotationToolbar({ rect, onHighlight, onNoteRequest, onDiscuss }) {
  const { refs, floatingStyles } = useFloating({
    strategy: 'fixed',
    placement: 'top',
    middleware: [offset(8), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  useEffect(() => {
    refs.setReference({ getBoundingClientRect: () => rect });
  }, [rect]);

  return (
    <div
      ref={refs.setFloating}
      className="ann-toolbar"
      style={floatingStyles}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="ann-toolbar-row">
        <button className="ann-btn highlight" onClick={onHighlight}>Highlight</button>
        <button className="ann-btn note" onClick={onNoteRequest}>Note</button>
        <button className="ann-btn discuss" onClick={onDiscuss}>Discuss</button>
      </div>
    </div>
  );
}
