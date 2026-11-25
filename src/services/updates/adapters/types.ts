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
  reason?: string;
}

export interface PlatformUpdateAdapter {
  getCapabilities(): PlatformUpdateCapabilities;
  getCurrentRuntimeIdentity(): RuntimeReleaseIdentity;
  stageAndVerify(input: {
    manifest: AuthoritativeReleaseManifest;
    baseUrl: string;
    signal?: AbortSignal;
    onProgress?: (progress: UpdateProgress) => void;
  }): Promise<StageUpdateResult>;
  activateTargetRelease(input: {
    targetReleaseId: string;
    returnUrl: string;
    allowReload: boolean;
  }): Promise<ActivateUpdateResult>;
  verifyPostBootHandshake(expectedReleaseId: string): Promise<BootHandshakeResult>;
  cleanupObsoleteCaches(activeReleaseId: string): Promise<void>;
  openStoreAction?(manifest: AuthoritativeReleaseManifest): void;
}
