import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

/** Where characters are built. Nothing to edit yet. */
function Editor(): JSX.Element | null {
  return null;
}

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <Editor />
    </StrictMode>
  );
}
