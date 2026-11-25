import type {
  CandidateReleaseRecord,
  InstalledReleaseRecord,
  LastCheckRecord,
  PendingActivationJournal,
  RuntimeReleaseIdentity,
} from './contracts';

const KEY_AUTO_UPDATE = 'minadental_auto_update_enabled';
const KEY_LAST_CHECK = 'minadental_v7_last_check';
const KEY_CANDIDATE = 'minadental_v7_candidate';
const KEY_PENDING_ACTIVATION = 'minadental_v7_pending_activation';
const KEY_INSTALLED_RELEASE = 'minadental_v7_installed_release';
const KEY_HIGHEST_SEQUENCE = 'minadental_v7_highest_sequence';
const KEY_LEADER_LEASE = 'minadental_v7_leader_lease';
/** Legacy compatibility key (synced ONLY after genuine verified boot installation) */
export const LEGACY_INSTALLED_RELEASE_KEY = 'minadental_installed_release_v1';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface LeaderLeaseRecord {
  tabId: string;
  fencingToken: number;
  expiresAt: number;
  scope: string;
}

function getDefaultStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Strictly separated persistent ledger for update discovery, candidate staging,
 * pending activation journal, and boot-verified installed release.
 *
 * CRITICAL INVARIANTS (V7 + V8):
 * 1. Checking for updates updates ONLY `lastCheck` — NEVER `installed.verifiedAt` and NEVER fires `release-upgraded`.
 * 2. Staging a candidate updates ONLY `candidate`.
 * 3. `pendingActivation` is written BEFORE activation & reload and is NEVER cleared blindly on dismiss.
 * 4. `installed` and `lastKnownGoodReleaseId` are updated ONLY after genuine post-boot attestation proves health.
 * 5. Cross-tab fallback lease uses monotonic fencing tokens, readback verification, renewal, and expiry.
 */
export class UpdateLedger {
  private readonly storage: StorageLike | null;

  constructor(storage?: StorageLike | null) {
    this.storage = storage === undefined ? getDefaultStorage() : storage;
  }

  private readJson<T>(key: string): T | null {
    if (!this.storage) return null;
    try {
      const raw = this.storage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  private writeJson(key: string, value: unknown): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(key, JSON.stringify(value));
    } catch {
      // ignore storage quota errors
    }
  }

  private removeKey(key: string): void {
    if (!this.storage) return;
    try {
      this.storage.removeItem(key);
    } catch {
      // ignore
    }
  }

  public isAutoUpdateEnabled(): boolean {
    if (!this.storage) return true;
    const raw = this.storage.getItem(KEY_AUTO_UPDATE);
    return raw === null ? true : raw === 'true';
  }

  public setAutoUpdateEnabled(enabled: boolean): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(KEY_AUTO_UPDATE, enabled ? 'true' : 'false');
    } catch {
      // ignore
    }
  }

  public getLastCheck(): LastCheckRecord | null {
    return this.readJson<LastCheckRecord>(KEY_LAST_CHECK);
  }

  public saveLastCheck(record: LastCheckRecord): void {
    this.writeJson(KEY_LAST_CHECK, record);
  }

  public getCandidate(): CandidateReleaseRecord | null {
    return this.readJson<CandidateReleaseRecord>(KEY_CANDIDATE);
  }

  public saveCandidate(record: CandidateReleaseRecord | null): void {
    if (!record) {
      this.removeKey(KEY_CANDIDATE);
      return;
    }
    this.writeJson(KEY_CANDIDATE, record);
  }

  public getPendingActivation(): PendingActivationJournal | null {
    return this.readJson<PendingActivationJournal>(KEY_PENDING_ACTIVATION);
  }

  public savePendingActivation(journal: PendingActivationJournal | null): void {
    if (!journal) {
      this.removeKey(KEY_PENDING_ACTIVATION);
      return;
    }
    this.writeJson(KEY_PENDING_ACTIVATION, journal);
  }

  public getHighestVerifiedSequence(): number {
    if (!this.storage) return 0;
    const raw = this.storage.getItem(KEY_HIGHEST_SEQUENCE);
    const num = Number(raw);
    return Number.isInteger(num) && num >= 0 ? num : 0;
  }

  public recordHighestVerifiedSequence(seq: number): void {
    if (!this.storage || !Number.isInteger(seq) || seq <= 0) return;
    const current = this.getHighestVerifiedSequence();
    if (seq > current) {
      try {
        this.storage.setItem(KEY_HIGHEST_SEQUENCE, String(seq));
      } catch {
        // ignore
      }
    }
  }

  public getInstalledRelease(runtime: RuntimeReleaseIdentity): InstalledReleaseRecord {
    const stored = this.readJson<InstalledReleaseRecord>(KEY_INSTALLED_RELEASE);
    if (stored && stored.releaseId === runtime.releaseId) {
      return stored;
    }

    // Runtime identity on disk/JS is authoritative over stale localStorage metadata.
    // V8: Do NOT fabricate lastKnownGoodReleaseId on an unverified first boot!
    return {
      releaseId: runtime.releaseId,
      contentDigest: runtime.contentDigest ?? null,
      releaseSequence: runtime.releaseSequence,
      semver: runtime.semver,
      channel: runtime.channel,
      platform: runtime.platform,
      verifiedAt: null,
      runtimeBuildId: runtime.releaseId,
      workerBuildId: null,
      releaseNotes: 'نسخه رسمی کلینیک مینادنتال',
      lastKnownGoodReleaseId: stored?.lastKnownGoodReleaseId ?? null,
      lastKnownGoodSequence: stored?.lastKnownGoodSequence ?? null,
    };
  }

  /**
   * Records an attested healthy first-install baseline as last-known-good
   * ONLY AFTER shell commit + route render + identity check pass (never before!).
   */
  public commitVerifiedBaseline(input: {
    runtime: RuntimeReleaseIdentity;
    workerBuildId: string | null;
  }): InstalledReleaseRecord {
    const existing = this.readJson<InstalledReleaseRecord>(KEY_INSTALLED_RELEASE);
    if (existing && existing.releaseId === input.runtime.releaseId && existing.lastKnownGoodReleaseId) {
      return existing;
    }
    const record: InstalledReleaseRecord = {
      releaseId: input.runtime.releaseId,
      contentDigest: input.runtime.contentDigest ?? null,
      releaseSequence: input.runtime.releaseSequence,
      semver: input.runtime.semver,
      channel: input.runtime.channel,
      platform: input.runtime.platform,
      verifiedAt: existing?.releaseId === input.runtime.releaseId ? existing.verifiedAt : null,
      runtimeBuildId: input.runtime.releaseId,
      workerBuildId: input.workerBuildId,
      releaseNotes: 'نسخه پایه تأییدشده کلینیک مینادنتال',
      lastKnownGoodReleaseId: input.runtime.releaseId,
      lastKnownGoodSequence: input.runtime.releaseSequence,
    };
    this.writeJson(KEY_INSTALLED_RELEASE, record);
    if (input.runtime.origin === 'ci_pipeline' && input.runtime.releaseSequence > 0) {
      this.recordHighestVerifiedSequence(input.runtime.releaseSequence);
    }
    return record;
  }

  /**
   * Commits a release as INSTALLED **ONLY** after real post-boot runtime + worker + route attestation.
   */
  public commitVerifiedInstalledRelease(input: {
    releaseId: string;
    contentDigest?: string | null;
    releaseSequence: number;
    semver: string;
    channel: InstalledReleaseRecord['channel'];
    platform: InstalledReleaseRecord['platform'];
    runtimeBuildId: string;
    workerBuildId: string | null;
    releaseNotes: string;
    verifiedAt?: string;
  }): InstalledReleaseRecord {
    const verifiedAt = input.verifiedAt ?? new Date().toISOString();
    const record: InstalledReleaseRecord = {
      releaseId: input.releaseId,
      contentDigest: input.contentDigest ?? null,
      releaseSequence: input.releaseSequence,
      semver: input.semver,
      channel: input.channel,
      platform: input.platform,
      verifiedAt,
      runtimeBuildId: input.runtimeBuildId,
      workerBuildId: input.workerBuildId,
      releaseNotes: input.releaseNotes,
      lastKnownGoodReleaseId: input.releaseId,
      lastKnownGoodSequence: input.releaseSequence,
    };
    this.writeJson(KEY_INSTALLED_RELEASE, record);
    this.recordHighestVerifiedSequence(input.releaseSequence);
    this.writeJson(LEGACY_INSTALLED_RELEASE_KEY, {
      version: input.semver,
      build: input.releaseSequence,
      releaseId: input.releaseId,
      releaseNotes: input.releaseNotes,
      installedAt: verifiedAt,
      lastCheckedAt: this.getLastCheck()?.checkedAt ?? verifiedAt,
    });
    return record;
  }

  /**
   * Cross-tab leader election lease fallback with monotonic fencing token, expiry & readback collision check.
   */
  public tryAcquireLeaderLeaseWithFence(
    tabId: string,
    leaseMs: number,
    scope = 'global',
    nowMs = Date.now()
  ): { acquired: boolean; fencingToken: number } {
    if (!this.storage) return { acquired: true, fencingToken: 1 };
    const key = `${KEY_LEADER_LEASE}_${scope}`;
    const current = this.readJson<LeaderLeaseRecord>(key);
    if (current && current.tabId !== tabId && current.expiresAt > nowMs) {
      return { acquired: false, fencingToken: current.fencingToken };
    }
    const nextToken = (current?.fencingToken ?? 0) + 1;
    const candidate: LeaderLeaseRecord = {
      tabId,
      fencingToken: nextToken,
      expiresAt: nowMs + leaseMs,
      scope,
    };
    this.writeJson(key, candidate);
    // Readback collision check: confirm our exact tabId + fencingToken won the write
    const verified = this.readJson<LeaderLeaseRecord>(key);
    const won = Boolean(verified && verified.tabId === tabId && verified.fencingToken === nextToken);
    return { acquired: won, fencingToken: nextToken };
  }

  public renewLeaderLease(
    tabId: string,
    fencingToken: number,
    leaseMs: number,
    scope = 'global',
    nowMs = Date.now()
  ): boolean {
    if (!this.storage) return true;
    const key = `${KEY_LEADER_LEASE}_${scope}`;
    const current = this.readJson<LeaderLeaseRecord>(key);
    if (!current || current.tabId !== tabId || current.fencingToken !== fencingToken) {
      return false;
    }
    this.writeJson(key, { ...current, expiresAt: nowMs + leaseMs });
    return true;
  }

  public tryAcquireLeaderLease(tabId: string, leaseMs: number, nowMs = Date.now()): boolean {
    return this.tryAcquireLeaderLeaseWithFence(tabId, leaseMs, 'global', nowMs).acquired;
  }

  public releaseLeaderLease(tabId: string, scope = 'global', fencingToken?: number): void {
    if (!this.storage) return;
    const key = `${KEY_LEADER_LEASE}_${scope}`;
    const current = this.readJson<LeaderLeaseRecord>(key);
    if (
      current &&
      current.tabId === tabId &&
      (fencingToken === undefined || current.fencingToken === fencingToken)
    ) {
      this.removeKey(key);
    }
  }
}
