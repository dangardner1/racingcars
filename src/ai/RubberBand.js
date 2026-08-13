/**
 * Nudges an AI car's target speed up when it's behind the leading human and
 * down when it's ahead, so the pack stays competitive without hard-scripted
 * catch-up teleportation.
 */
const MAX_ADJUST = 0.15;
const GAIN = 0.01; // speed adjustment per unit of track-progress gap

export function rubberBandMultiplier(carProgress, leaderProgress) {
  const gap = leaderProgress - carProgress; // positive: AI is behind
  const adjust = Math.max(-MAX_ADJUST, Math.min(MAX_ADJUST, gap * GAIN));
  return 1 + adjust;
}
