import React, { useState, useEffect } from 'react';
import Library from './screens/Library.jsx';
import Reader from './screens/Reader.jsx';

function parseHash(hash) {
  // '#/reader/BOOK_ID' → { screen: 'reader', bookId: 'BOOK_ID' }
  // '#/library' or '' → { screen: 'library' }
  const readerMatch = hash.match(/^#\/reader\/(.+)$/);
  if (readerMatch) {
    return { screen: 'reader', bookId: readerMatch[1] };
  }
  return { screen: 'library' };
}

export default function App() {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));

  useEffect(() => {
    const onHashChange = () => {
      setRoute(parseHash(window.location.hash));
    };

    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  if (route.screen === 'reader') {
    return <Reader bookId={route.bookId} />;
  }

  return <Library />;
}
