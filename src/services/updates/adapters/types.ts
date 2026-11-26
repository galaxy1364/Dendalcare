import type {
  AuthoritativeReleaseManifest,
  PlatformUpdateCapabilities,
  RuntimeReleaseIdentity,
  UpdateErrorCode,
  UpdateProgress,
} from '../contracts';

export interface StageUpdateResult {
  ok: boolean;
  verifiedAssetsCount: number;
  waitingWorkerBuildId: string | null;
  workerVerified?: boolean;
  stagingStrategy?: 'service_worker' | 'browser_navigation';
  errorCode?: UpdateErrorCode;
  detail?: string;
}

export interface ActivateUpdateResult {
  ok: boolean;
  reloadTriggered: boolean;
  errorCode?: UpdateErrorCode;
  detail?: string;
}

export interface BootHandshakeResult {
  verified: boolean;
  runtimeBuildId: string;
  workerBuildId: string | null;
  routeRendered?: boolean;
  embeddedMatch?: boolean;
  reason?: string;
}

export interface PlatformUpdateAdapter {
  getCapabilities(): PlatformUpdateCapabilities;
  getCurrentRuntimeIdentity(): RuntimeReleaseIdentity;
  getDefaultPointerUrl?(): string;
  stageAndVerify(input: {
    manifest: AuthoritativeReleaseManifest;
    manifestUrl?: string | null;
    baseUrl: string;
    signal?: AbortSignal;
    onProgress?: (progress: UpdateProgress) => void;
  }): Promise<StageUpdateResult>;
  activateTargetRelease(input: {
    targetReleaseId: string;
    returnUrl: string;
    allowReload: boolean;
    beforeReload?: () => void;
  }): Promise<ActivateUpdateResult>;
  verifyPostBootHandshake(
    expectedReleaseId: string,
    options?: {
      expectedContentDigest?: string | null;
      expectedSemver?: string | null;
      requireWorkerMatch?: boolean;
      requireRouteRendered?: boolean;
    }
  ): Promise<BootHandshakeResult>;
  cleanupObsoleteCaches(
    activeReleaseId: string,
    options?: { lastKnownGoodReleaseId?: string | null }
  ): Promise<void>;
  reportClientReleaseLease?(tabId: string, buildId: string): void;
  openStoreAction?(manifest: AuthoritativeReleaseManifest): void;
}
