import { useEffect, useState } from 'react';
import {
  useAppearanceSettings,
  type AuroraBackdropMode,
} from '@/design-system/themes/appearance';

export interface AuroraBackgroundProps {
  /** Optional explicit override for low-power/static diagnostics or testing */
  modeOverride?: AuroraBackdropMode;
}

/**
 * Pure runtime helper: resolves whether Aurora mesh animation must pause.
 */
export function shouldPauseAuroraMotion(params: {
  isDocumentHidden: boolean;
  reduceMotion: boolean;
  effectiveMode: AuroraBackdropMode;
}): boolean {
  return (
    params.isDocumentHidden ||
    params.reduceMotion ||
    params.effectiveMode === 'static'
  );
}

/**
 * FIX 01 — Live Fluid Gemini-Inspired Aurora Mesh Background
 *
 * - Mesh gradient with Sky Blue, Lilac/Violet, Mint, and Soft Pink blobs
 * - GPU-composited motion strictly via `transform` and `opacity` (18s–30s calm cycles)
 * - Automatically pauses when tab is backgrounded (`document.hidden`) or Reduce Motion is active
 * - Supports `live`, `low_power`, and `static` modes
 * - `pointer-events-none` + protective surface contrast scrim so foreground typography stays WCAG AA+
 */
export function AuroraBackground({ modeOverride }: AuroraBackgroundProps = {}) {
  const appearance = useAppearanceSettings();
  const effectiveMode = modeOverride ?? appearance.resolvedAuroraMode;
  const isDark = appearance.resolvedTheme === 'dark';

  const [isDocumentHidden, setIsDocumentHidden] = useState<boolean>(() =>
    typeof document !== 'undefined' ? document.hidden : false
  );

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVisibility = () => setIsDocumentHidden(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const isPaused = shouldPauseAuroraMotion({
    isDocumentHidden,
    reduceMotion: appearance.resolvedReduceMotion,
    effectiveMode,
  });

  const isLowPower = effectiveMode === 'low_power';

  return (
    <div
      aria-hidden="true"
      data-testid="aurora_background_layer"
      data-aurora-effective={effectiveMode}
      data-aurora-paused={isPaused ? 'true' : 'false'}
      className={`aurora-mesh-canvas ${isDark ? 'aurora-mesh-dark' : 'aurora-mesh-light'} ${
        isPaused ? 'aurora-paused' : ''
      } ${isLowPower ? 'aurora-low-power' : ''}`}
    >
      {/* Sky Blue Mesh Blob (20s cycle) */}
      <div className="aurora-mesh-blob aurora-blob-blue" />

      {/* Lilac / Soft Violet Mesh Blob (25s cycle) */}
      <div className="aurora-mesh-blob aurora-blob-lilac" />

      {/* Mint / Aqua Mesh Blob (29s cycle — omitted in low_power mode to cut GPU fill rate) */}
      {!isLowPower && <div className="aurora-mesh-blob aurora-blob-mint" />}

      {/* Soft Pink / Rose Mesh Blob (18s cycle — omitted in low_power mode) */}
      {!isLowPower && <div className="aurora-mesh-blob aurora-blob-pink" />}

      {/* Protective Contrast Veil so foreground cards & typography remain crystal clear */}
      <div className="aurora-contrast-veil" />
    </div>
  );
}
