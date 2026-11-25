import { useEffect, useState } from 'react';

/**
 * V5/V8.1 Explicit Bootstrap State Machine with distinct boot milestones:
 *   BOOTING -> SHELL_READY -> AUTH_RESOLVING -> READY | DEGRADED | ERROR
 *
 * Tracks granular milestones:
 *   moduleEvaluatedAt -> shellCommittedAt -> authResolvedAt -> routeRenderedAt -> readyAt
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
  moduleEvaluatedAt: number | null;
  shellCommittedAt: number | null;
  authResolvedAt: number | null;
  routeRenderedAt: number | null;
  readyAt: number | null;
  renderedRoute: string | null;
  diagnosticCode: string | null;
  diagnosticMessage: string | null;
  nonFatalWarnings: Array<{ code: string; detail: string; at: number }>;
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
  recordMilestone: (
    milestone: 'module_evaluated' | 'route_rendered',
    route?: string | null
  ) => BootstrapSnapshot;
  transition: (
    next: BootstrapStage,
    diagnostic?: { code?: string | null; message?: string | null }
  ) => BootstrapSnapshot;
  subscribe: (listener: (snap: BootstrapSnapshot) => void) => () => void;
}

export function createBootstrapMachine(): BootstrapMachine {
  let snapshot: BootstrapSnapshot = {
    stage: 'BOOTING',
    moduleEvaluatedAt: null,
    shellCommittedAt: null,
    authResolvedAt: null,
    routeRenderedAt: null,
    readyAt: null,
    renderedRoute: null,
    diagnosticCode: null,
    diagnosticMessage: null,
    nonFatalWarnings:
      typeof window !== 'undefined' && Array.isArray(window.__minaBootWarnings)
        ? [...window.__minaBootWarnings]
        : [],
  };
  const listeners = new Set<(snap: BootstrapSnapshot) => void>();

  const syncWarnings = () => {
    if (typeof window !== 'undefined' && Array.isArray(window.__minaBootWarnings)) {
      snapshot = {
        ...snapshot,
        nonFatalWarnings: [...window.__minaBootWarnings],
      };
    }
  };

  const notify = () => {
    syncWarnings();
    listeners.forEach((fn) => {
      try {
        fn(snapshot);
      } catch {
        // ignore subscriber errors
      }
    });
  };

  return {
    getSnapshot: () => {
      syncWarnings();
      return snapshot;
    },
    recordMilestone(milestone, route) {
      const now = Date.now();
      if (milestone === 'module_evaluated') {
        snapshot = {
          ...snapshot,
          moduleEvaluatedAt: snapshot.moduleEvaluatedAt ?? now,
        };
      } else if (milestone === 'route_rendered') {
        snapshot = {
          ...snapshot,
          routeRenderedAt: snapshot.routeRenderedAt ?? now,
          renderedRoute: route ?? snapshot.renderedRoute ?? 'dashboard',
        };
      }
      if (typeof window !== 'undefined' && window.__minaBootMilestones) {
        if (milestone === 'module_evaluated') {
          window.__minaBootMilestones.moduleEvaluatedAt = snapshot.moduleEvaluatedAt;
        } else if (milestone === 'route_rendered') {
          window.__minaBootMilestones.routeRenderedAt = snapshot.routeRenderedAt;
        }
      }
      notify();
      return snapshot;
    },
    transition(next, diagnostic) {
      if (snapshot.stage === next && !diagnostic) return snapshot;
      const allowed = VALID_TRANSITIONS[snapshot.stage];
      if (!allowed.includes(next)) {
        return snapshot;
      }

      const now = Date.now();
      snapshot = {
        ...snapshot,
        stage: next,
        shellCommittedAt:
          next === 'SHELL_READY' ? snapshot.shellCommittedAt ?? now : snapshot.shellCommittedAt,
        authResolvedAt:
          next === 'READY' || next === 'DEGRADED' || next === 'ERROR'
            ? snapshot.authResolvedAt ?? now
            : snapshot.authResolvedAt,
        readyAt: next === 'READY' ? snapshot.readyAt ?? now : snapshot.readyAt,
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
        window.__minaBootState = snapshot.stage;
        if (window.__minaBootMilestones) {
          window.__minaBootMilestones.shellCommittedAt = snapshot.shellCommittedAt;
          window.__minaBootMilestones.authResolvedAt = snapshot.authResolvedAt;
          window.__minaBootMilestones.readyAt = snapshot.readyAt;
        }
      }

      notify();
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

export function markModuleEvaluated(): void {
  appBootstrap.recordMilestone('module_evaluated');
}

export function markRouteRendered(route: string): void {
  appBootstrap.recordMilestone('route_rendered', route);
}

/**
 * Post-commit handshake invoked ONLY from root React `useEffect` after the shell commits to DOM.
 * Cancels the independent boot watchdog timer and removes the splash overlay cleanly.
 */
export function markShellCommitted(): void {
  appBootstrap.transition('SHELL_READY');
  if (typeof window !== 'undefined') {
    window.__minaAppMounted = true;
    window.__minaBootState = appBootstrap.getSnapshot().stage;
    window.__minaCancelBootWatchdog?.();
  }
  if (typeof document !== 'undefined') {
    const splashEl = document.getElementById('app-splash');
    if (splashEl) {
      splashEl.style.opacity = '0';
      splashEl.remove();
    }
    const errEl = document.getElementById('boot-error');
    if (errEl && appBootstrap.getSnapshot().stage !== 'ERROR') {
      errEl.style.display = 'none';
    }
  }
}

export function useBootstrapState(): BootstrapSnapshot {
  const [snap, setSnap] = useState<BootstrapSnapshot>(() => appBootstrap.getSnapshot());
  useEffect(() => appBootstrap.subscribe(setSnap), []);
  return snap;
}
