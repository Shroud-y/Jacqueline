import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Editor from './Editor';
import './tokens.css';
import './editor.css';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <Editor />
    </StrictMode>
  );
}
