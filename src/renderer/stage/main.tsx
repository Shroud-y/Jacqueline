import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Stage from './Stage';
import '../shared/fonts.css';
import './stage.css';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <Stage />
    </StrictMode>
  );
}
