import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

/** A character's window: draws its layout. Nothing to draw yet. */
function Stage(): JSX.Element | null {
  return null;
}

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <Stage />
    </StrictMode>
  );
}
