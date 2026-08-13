/**
 * Shared side-scrolling camera for 2 local players (chosen over split-screen
 * — see plan: with 9 AI cars also on screen, halving screen space would make
 * hazards/opponents too hard to read). Frames the midpoint of both human
 * players and zooms out as they separate, clamped to a max spread so they
 * never shrink to unreadable dots; a trailing-player indicator kicks in
 * once that clamp is reached.
 */
const BASE_DISTANCE = 14;
const BASE_HEIGHT = 3.5;
const MAX_EXTRA_DISTANCE = 18;
const ZOOM_START_SPREAD = 15; // players closer than this: no zoom-out
const ZOOM_MAX_SPREAD = 60; // beyond this, camera stops zooming out further
const SMOOTHING = 4; // higher = snappier follow

const SHAKE_DECAY = 3.5; // trauma units/sec

export class SideScrollCamera {
  constructor(camera) {
    this.camera = camera;
    this.camX = 0;
    this.camY = BASE_HEIGHT;
    this.camDistance = BASE_DISTANCE;
    this.maxSpreadReached = false;
    this.trauma = 0;
  }

  /** Adds screen shake, e.g. on a hard crash. Clamped so repeated big hits
   * don't stack into a disorienting max shake forever. */
  addShake(amount) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  update(p1, p2, dt) {
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;
    const spread = Math.abs(p1.x - p2.x);

    const zoomT = clamp(
      (spread - ZOOM_START_SPREAD) / (ZOOM_MAX_SPREAD - ZOOM_START_SPREAD),
      0,
      1
    );
    this.maxSpreadReached = spread >= ZOOM_MAX_SPREAD;

    const targetDistance = BASE_DISTANCE + zoomT * MAX_EXTRA_DISTANCE;
    const targetY = BASE_HEIGHT + midY * 0.3;

    const lerpFactor = 1 - Math.exp(-SMOOTHING * dt);
    this.camX += (midX - this.camX) * lerpFactor;
    this.camY += (targetY - this.camY) * lerpFactor;
    this.camDistance += (targetDistance - this.camDistance) * lerpFactor;

    this.trauma = Math.max(0, this.trauma - SHAKE_DECAY * dt);
    const shake = this.trauma * this.trauma; // squared falloff: sharp punch, quick settle
    const shakeX = (Math.random() * 2 - 1) * shake * 0.6;
    const shakeY = (Math.random() * 2 - 1) * shake * 0.4;

    this.camera.position.set(this.camX + shakeX, this.camY + shakeY, this.camDistance);
    this.camera.lookAt(this.camX, this.camY - BASE_HEIGHT + 0.5, 0);

    // Trailing-player indicator: which player is furthest from camera
    // center once we've hit max zoom-out (they may be drifting off-frame).
    this.trailingPlayer = null;
    if (this.maxSpreadReached) {
      this.trailingPlayer = p1.x < p2.x
        ? (Math.abs(p1.x - this.camX) > Math.abs(p2.x - this.camX) ? 1 : 2)
        : (Math.abs(p2.x - this.camX) > Math.abs(p1.x - this.camX) ? 2 : 1);
    }
  }
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}
