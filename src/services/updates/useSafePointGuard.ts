import { useEffect } from 'react';
import { updateCoordinator } from './index';

/**
 * Registers a live safe-point busy guard on the central UpdateCoordinator whenever
 * a clinical form, financial entry, or edit sheet has unsaved modifications (`isDirty = true`).
 * Automatically unregisters on save/clean/unmount so deferred autonomous updates can resume safely.
 */
export function useUpdateSafePointGuard(
  guardId: string,
  isDirty: boolean,
  reason: string
): void {
  useEffect(() => {
    if (!isDirty) return;
    const release = updateCoordinator.registerBusyGuard(guardId, reason);
    return () => {
      release();
    };
  }, [guardId, isDirty, reason]);
}
