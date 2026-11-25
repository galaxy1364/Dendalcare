import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { appBootstrap, sanitizeLogMessage } from './app/bootstrapState';
import { RootErrorBoundary } from './components/RootErrorBoundary';
import './index.css';

if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    const safeMsg = sanitizeLogMessage(event.reason);
    console.error('[MinaDental UnhandledRejection]', safeMsg);
    if (!window.__minaAppMounted) {
      appBootstrap.transition('ERROR', {
        code: 'UNHANDLED_BOOT_REJECTION',
        message: safeMsg,
      });
      const bootErr = document.getElementById('boot-error');
      if (bootErr) bootErr.style.display = 'block';
    }
  });
}

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
        <RootErrorBoundary maxRetries={2}>
          <App />
        </RootErrorBoundary>
      </StrictMode>
    );
    // NOTE (V5/V6): Do NOT set window.__minaAppMounted here synchronously.
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
