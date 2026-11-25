import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { appBootstrap, markModuleEvaluated, sanitizeLogMessage } from './app/bootstrapState';
import { RootErrorBoundary } from './components/RootErrorBoundary';
import './index.css';

// V8.1 Boot Milestone 1: Entry module successfully evaluated
markModuleEvaluated();

if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    const safeMsg = sanitizeLogMessage(event.reason);
    console.error('[MinaDental UnhandledRejection]', safeMsg);
    if (!window.__minaAppMounted) {
      appBootstrap.transition('ERROR', {
        code: 'UNHANDLED_BOOT_REJECTION',
        message: safeMsg,
      });
      if (typeof window.__minaShowBootRecovery === 'function') {
        window.__minaShowBootRecovery('UNHANDLED_BOOT_REJECTION', safeMsg);
      } else {
        const bootErr = document.getElementById('boot-error');
        if (bootErr) bootErr.style.display = 'block';
      }
    }
  });
}

const rootEl = document.getElementById('root');

if (!rootEl) {
  appBootstrap.transition('ERROR', {
    code: 'ROOT_MISSING',
    message: 'عنصر ریشه رابط کاربری (#root) یافت نشد.',
  });
  if (typeof window !== 'undefined' && typeof window.__minaShowBootRecovery === 'function') {
    window.__minaShowBootRecovery('ROOT_MISSING', '#root missing');
  }
} else {
  try {
    createRoot(rootEl).render(
      <StrictMode>
        <RootErrorBoundary maxRetries={2}>
          <App />
        </RootErrorBoundary>
      </StrictMode>
    );
    // NOTE (V5/V6/V8.1): Do NOT set window.__minaAppMounted synchronously.
    // The genuine post-commit handshake fires in AppProviders' root useEffect via markShellCommitted(),
    // and route readiness fires in AppRouter via markRouteRendered(activeRoute).
  } catch (err) {
    const safeMsg = sanitizeLogMessage(err);
    appBootstrap.transition('ERROR', {
      code: 'MOUNT_FAILED',
      message: safeMsg,
    });
    if (typeof window !== 'undefined' && typeof window.__minaShowBootRecovery === 'function') {
      window.__minaShowBootRecovery('MOUNT_FAILED', safeMsg);
    } else {
      const bootErr = document.getElementById('boot-error');
      if (bootErr) bootErr.style.display = 'block';
    }
    console.error('[MinaDental Boot Error]', safeMsg);
  }
}
