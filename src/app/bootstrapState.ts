import { useEffect, useState } from 'react';

/**
 * V5 P0-04 Explicit Bootstrap State Machine:
 *   BOOTING -> SHELL_READY -> AUTH_RESOLVING -> READY | DEGRADED | ERROR
 *
 * Strictly enforces post-commit shell readiness and never bypasses Auth/RLS.
 */
export type BootstrapStage =
  | 'BOOTING'
  | 'SHELL_READY'
  | 'AUTH_RESOLVING'
  | 'READY'
  | 'DEGRADED'
  | 'ERROR';

export interface BootstrapSnapshot {
  stage: BootstrapStage;
  shellCommittedAt: number | null;
  authResolvedAt: number | null;
  diagnosticCode: string | null;
  diagnosticMessage: string | null;
}

const VALID_TRANSITIONS: Record<BootstrapStage, readonly BootstrapStage[]> = {
  BOOTING: ['SHELL_READY', 'ERROR'],
  SHELL_READY: ['AUTH_RESOLVING', 'DEGRADED', 'ERROR'],
  AUTH_RESOLVING: ['READY', 'DEGRADED', 'ERROR'],
  READY: ['AUTH_RESOLVING', 'DEGRADED', 'ERROR'],
  DEGRADED: ['AUTH_RESOLVING', 'READY', 'ERROR'],
  ERROR: ['SHELL_READY', 'AUTH_RESOLVING', 'READY', 'DEGRADED'],
};

/**
 * Sanitizes error messages & diagnostic text so no JWTs, Bearer tokens,
 * API keys, email addresses, or Iranian phone numbers are ever leaked to logs/UI.
 */
export function sanitizeLogMessage(input: unknown): string {
  const raw =
    input instanceof Error
      ? input.message || input.name
      : typeof input === 'string'
      ? input
      : 'خطای داخلی سامانه';

  return raw
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]')
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[JWT_REDACTED]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[EMAIL_REDACTED]')
    .replace(/\b09\d{9}\b/g, '[PHONE_REDACTED]')
    .replace(/(apikey|api_key|token|password|secret)=[^&\s]+/gi, '$1=[REDACTED]')
    .slice(0, 240);
}

export interface BootstrapMachine {
  getSnapshot: () => BootstrapSnapshot;
  transition: (
    next: BootstrapStage,
    diagnostic?: { code?: string | null; message?: string | null }
  ) => BootstrapSnapshot;
  subscribe: (listener: (snap: BootstrapSnapshot) => void) => () => void;
}

export function createBootstrapMachine(): BootstrapMachine {
  let snapshot: BootstrapSnapshot = {
    stage: 'BOOTING',
    shellCommittedAt: null,
    authResolvedAt: null,
    diagnosticCode: null,
    diagnosticMessage: null,
  };
  const listeners = new Set<(snap: BootstrapSnapshot) => void>();

  return {
    getSnapshot: () => snapshot,
    transition(next, diagnostic) {
      if (snapshot.stage === next && !diagnostic) return snapshot;
      const allowed = VALID_TRANSITIONS[snapshot.stage];
      if (!allowed.includes(next)) {
        return snapshot;
      }

      const now = Date.now();
      snapshot = {
        stage: next,
        shellCommittedAt:
          next === 'SHELL_READY' ? snapshot.shellCommittedAt ?? now : snapshot.shellCommittedAt,
        authResolvedAt:
          next === 'READY' || next === 'DEGRADED' || next === 'ERROR'
            ? now
            : snapshot.authResolvedAt,
        diagnosticCode: diagnostic?.code ?? (next === 'READY' ? null : snapshot.diagnosticCode),
        diagnosticMessage:
          diagnostic?.message !== undefined
            ? diagnostic.message
              ? sanitizeLogMessage(diagnostic.message)
              : null
            : next === 'READY'
            ? null
            : snapshot.diagnosticMessage,
      };

      if (typeof window !== 'undefined') {
        (window as any).__minaBootState = snapshot.stage;
      }

      listeners.forEach((fn) => {
        try {
          fn(snapshot);
        } catch {
          // ignore subscriber errors
        }
      });

      return snapshot;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const appBootstrap = createBootstrapMachine();

/**
 * Post-commit handshake invoked ONLY from root React `useEffect` after the shell commits to DOM.
 * Replaces the broken synchronous `window.__minaAppMounted = true` in `main.tsx`.
 */
export function markShellCommitted(): void {
  appBootstrap.transition('SHELL_READY');
  if (typeof window !== 'undefined') {
    (window as any).__minaAppMounted = true;
    (window as any).__minaBootState = appBootstrap.getSnapshot().stage;
  }
  if (typeof document !== 'undefined') {
    const splashEl = document.getElementById('app-splash');
    if (splashEl) {
      splashEl.style.opacity = '0';
      splashEl.remove();
    }
  }
}

export function useBootstrapState(): BootstrapSnapshot {
  const [snap, setSnap] = useState<BootstrapSnapshot>(() => appBootstrap.getSnapshot());
  useEffect(() => appBootstrap.subscribe(setSnap), []);
  return snap;
}
