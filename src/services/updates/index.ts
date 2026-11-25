import { UpdateCoordinator } from './coordinator';

export * from './contracts';
export * from './releaseIdentity';
export * from './policy';
export * from './ledger';
export * from './telemetry';
export * from './manifestClient';
export * from './coordinator';
export * from './adapters/types';
export * from './adapters/webPwaAdapter';
export * from './adapters/nativePlatformAdapter';
export * from './useSafePointGuard';

/**
 * Process-wide singleton UpdateCoordinator.
 * All UI surfaces (AppProviders, AppShell, Settings, Operational Forms) subscribe to this single coordinator.
 */
export const updateCoordinator = new UpdateCoordinator();
