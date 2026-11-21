import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Suppress benign internal GSI FedCM logger warnings in embedded iframe preview
if (typeof window !== 'undefined') {
  const origConsoleError = console.error;
  console.error = (...args: any[]) => {
    const msg = typeof args[0] === 'string' ? args[0] : '';
    if (msg.includes('[GSI_LOGGER]') && (msg.includes('FedCM') || msg.includes('identity-credentials-get'))) {
      console.debug('[GSI Info (handled)]', ...args);
      return;
    }
    origConsoleError.apply(console, args);
  };

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason?.message || String(event.reason || '');
    if (reason.includes('identity-credentials-get') || reason.includes('FedCM')) {
      event.preventDefault();
      console.debug('[Suppressed FedCM rejection]', event.reason);
    }
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
