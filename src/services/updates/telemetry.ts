import { sanitizeLogMessage } from '@/app/bootstrapState';
import type {
  UpdateDiagnosticEvent,
  UpdateErrorCode,
  UpdateMetricsSnapshot,
  UpdateState,
} from './contracts';

const MAX_DIAGNOSTIC_EVENTS = 40;

export function createCorrelationId(prefix = 'upd'): string {
  const rand =
    typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function'
      ? globalThis.crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

/**
 * Sanitized, zero-PII/zero-credential diagnostics & aggregate telemetry collector.
 */
export class UpdateTelemetryStore {
  private events: UpdateDiagnosticEvent[] = [];
  private metrics: UpdateMetricsSnapshot = {
    checksTotal: 0,
    checksSucceeded: 0,
    checksFailed: 0,
    downloadsStarted: 0,
    downloadsVerified: 0,
    activationsAttempted: 0,
    bootVerifiedSuccesses: 0,
    bootFailures: 0,
    recoveryCount: 0,
    reloadLoopsBlocked: 0,
    lastTimeToReadyMs: null,
    lastDiscoveryDurationMs: null,
  };

  public record(input: {
    correlationId: string;
    event: string;
    state: UpdateState;
    runtimeReleaseId: string;
    candidateReleaseId?: string | null;
    errorCode?: UpdateErrorCode | null;
    detail?: unknown;
  }): void {
    const entry: UpdateDiagnosticEvent = {
      timestamp: new Date().toISOString(),
      correlationId: input.correlationId,
      event: input.event,
      state: input.state,
      runtimeReleaseId: input.runtimeReleaseId,
      candidateReleaseId: input.candidateReleaseId ?? null,
      errorCode: input.errorCode ?? null,
      detail: input.detail !== undefined ? sanitizeLogMessage(input.detail) : '',
    };
    this.events = [entry, ...this.events].slice(0, MAX_DIAGNOSTIC_EVENTS);
  }

  public increment(
    key: Exclude<keyof UpdateMetricsSnapshot, 'lastTimeToReadyMs' | 'lastDiscoveryDurationMs'>
  ): void {
    this.metrics = {
      ...this.metrics,
      [key]: this.metrics[key] + 1,
    };
  }

  public setTiming(key: 'lastTimeToReadyMs' | 'lastDiscoveryDurationMs', ms: number): void {
    this.metrics = {
      ...this.metrics,
      [key]: Math.max(0, Math.round(ms)),
    };
  }

  public getMetrics(): UpdateMetricsSnapshot {
    return { ...this.metrics };
  }

  public getRecentEvents(): UpdateDiagnosticEvent[] {
    return [...this.events];
  }
}
