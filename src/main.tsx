import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { appBootstrap, sanitizeLogMessage } from './app/bootstrapState';
import './index.css';

const rootEl = document.getElementById('root');

if (!rootEl) {
  appBootstrap.transition('ERROR', {
    code: 'ROOT_MISSING',
    message: 'عنصر ریشه رابط کاربری (#root) یافت نشد.',
  });
} else {
  try {
    createRoot(rootEl).render(
      <StrictMode>
        <App />
      </StrictMode>
    );
    // NOTE (V5 P0-04): Do NOT set window.__minaAppMounted here synchronously.
    // The real post-commit handshake fires inside AppProviders' root useEffect via markShellCommitted().
  } catch (err) {
    const safeMsg = sanitizeLogMessage(err);
    appBootstrap.transition('ERROR', {
      code: 'MOUNT_FAILED',
      message: safeMsg,
    });
    const bootErr = document.getElementById('boot-error');
    if (bootErr) bootErr.style.display = 'block';
    console.error('[MinaDental Boot Error]', safeMsg);
  }
}
