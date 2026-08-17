import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { registerEngineCache } from './engine/register-engine-cache.js';
import './styles/tokens.css';
import './styles/base.css';

registerEngineCache();

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
