// Cohesive, cancellable transitions (zero continuous decorative infinite animations)
export const MOTION_TOKENS = Object.freeze({
  easingStandard: 'cubic-bezier(0.22, 1, 0.36, 1)',
  easingSpringSoft: 'cubic-bezier(0.32, 0.72, 0, 1)',
  durationRouteMs: 220,
  durationSheetMs: 260,
  durationFeedbackMs: 140,
  reducedDurationMs: 0,
  allowContinuousDecorations: false,
});
