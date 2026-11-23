import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { installTapGuard } from './tapGuard';
import { installTapNotice } from './tapNotice';
import '#font';
import './styles/tokens.css';
import './styles/app.css';

installTapGuard();
installTapNotice();

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
