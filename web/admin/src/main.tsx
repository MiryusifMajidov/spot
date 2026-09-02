import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import { AuthProvider } from './lib/auth';
import { IconSprite } from './ui/icons';
import { ToastHost } from './ui/toast';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <IconSprite />
    <AuthProvider>
      <App />
    </AuthProvider>
    <ToastHost />
  </StrictMode>
);
