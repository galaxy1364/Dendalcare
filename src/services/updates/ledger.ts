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
 * CRITICAL INVARIANTS:
 * 1. Checking for updates updates ONLY `lastCheck` — NEVER `installed.verifiedAt` and NEVER fires `release-upgraded`.
 * 2. Staging a candidate updates ONLY `candidate`.
 * 3. `pendingActivation` is written BEFORE activation and cleared ONLY after post-boot verification or terminal recovery.
 * 4. `installed` is updated ONLY after genuine boot verification proves the target release is actually running.
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

    // Runtime identity on disk/DOM is authoritative over stale localStorage metadata
    const fresh: InstalledReleaseRecord = {
      releaseId: runtime.releaseId,
      releaseSequence: runtime.releaseSequence,
      semver: runtime.semver,
      channel: runtime.channel,
      platform: runtime.platform,
      verifiedAt: stored?.releaseId === runtime.releaseId ? stored.verifiedAt : null,
      runtimeBuildId: runtime.releaseId,
      workerBuildId: stored?.releaseId === runtime.releaseId ? stored.workerBuildId : null,
      releaseNotes:
        stored?.releaseId === runtime.releaseId
          ? stored.releaseNotes
          : 'نسخه رسمی کلینیک مینادنتال',
      lastKnownGoodReleaseId: stored?.lastKnownGoodReleaseId || runtime.releaseId,
      lastKnownGoodSequence: stored?.lastKnownGoodSequence || runtime.releaseSequence,
    };
    return fresh;
  }

  /**
   * Commits a release as INSTALLED **ONLY** after real post-boot runtime + worker identity verification.
   */
  public commitVerifiedInstalledRelease(input: {
    releaseId: string;
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
   * Cross-tab leader election lease fallback when Web Locks API is unavailable.
   */
  public tryAcquireLeaderLease(tabId: string, leaseMs: number, nowMs = Date.now()): boolean {
    if (!this.storage) return true;
    const current = this.readJson<{ tabId: string; expiresAt: number }>(KEY_LEADER_LEASE);
    if (current && current.tabId !== tabId && current.expiresAt > nowMs) {
      return false;
    }
    this.writeJson(KEY_LEADER_LEASE, { tabId, expiresAt: nowMs + leaseMs });
    return true;
  }

  public releaseLeaderLease(tabId: string): void {
    if (!this.storage) return;
    const current = this.readJson<{ tabId: string; expiresAt: number }>(KEY_LEADER_LEASE);
    if (current && current.tabId === tabId) {
      this.removeKey(KEY_LEADER_LEASE);
    }
  }
}
