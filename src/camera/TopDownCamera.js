/**
 * Shared elevated top-down/three-quarter camera for 2 local players (chosen
 * over split-screen — with 3 AI cars also on screen, halving screen space
 * would make hazards/opponents too hard to read). Frames the midpoint of
 * both human players and zooms out as they separate, clamped to a max
 * spread so they never shrink to unreadable dots; a trailing-player
 * indicator kicks in once that clamp is reached.
 *
 * The camera sits at a fixed world-space offset above and behind the
 * tracked point — it does not rotate to follow either player's heading.
 * That keeps a figure-eight (which doubles back on itself) and elevation
 * changes (hills/tunnels/bridges) easy to read without the extra
 * complexity/disorientation of a heading-following chase camera.
 */
const BASE_HEIGHT = 28;
const BASE_BACK = 20; // fixed world +Z offset behind the framed point
const MAX_EXTRA = 24;
const ZOOM_START_SPREAD = 15; // players closer than this (XZ distance): no zoom-out
const ZOOM_MAX_SPREAD = 70; // beyond this, camera stops zooming out further
const SMOOTHING = 4; // higher = snappier follow

const SHAKE_DECAY = 3.5; // trauma units/sec

export class TopDownCamera {
  constructor(camera) {
    this.camera = camera;
    this.camX = 0;
    this.camY = 0;
    this.camZ = 0;
    this.zoom = 0; // 0..1, smoothed toward zoomT each frame
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
    const midZ = (p1.z + p2.z) / 2;
    const spread = Math.hypot(p1.x - p2.x, p1.z - p2.z);

    const zoomT = clamp((spread - ZOOM_START_SPREAD) / (ZOOM_MAX_SPREAD - ZOOM_START_SPREAD), 0, 1);
    this.maxSpreadReached = spread >= ZOOM_MAX_SPREAD;

    const lerpFactor = 1 - Math.exp(-SMOOTHING * dt);
    this.camX += (midX - this.camX) * lerpFactor;
    this.camY += (midY - this.camY) * lerpFactor;
    this.camZ += (midZ - this.camZ) * lerpFactor;
    this.zoom += (zoomT - this.zoom) * lerpFactor;

    const extra = this.zoom * MAX_EXTRA;
    const height = BASE_HEIGHT + extra;
    const back = BASE_BACK + extra * 0.7;

    this.trauma = Math.max(0, this.trauma - SHAKE_DECAY * dt);
    const shake = this.trauma * this.trauma; // squared falloff: sharp punch, quick settle
    const shakeX = (Math.random() * 2 - 1) * shake * 1.2;
    const shakeZ = (Math.random() * 2 - 1) * shake * 1.2;

    this.camera.position.set(this.camX + shakeX, this.camY + height, this.camZ + back + shakeZ);
    this.camera.lookAt(this.camX, this.camY, this.camZ);

    // Trailing-player indicator: which player is furthest from camera
    // center once we've hit max zoom-out (they may be drifting off-frame).
    this.trailingPlayer = null;
    if (this.maxSpreadReached) {
      const d1 = Math.hypot(p1.x - this.camX, p1.z - this.camZ);
      const d2 = Math.hypot(p2.x - this.camX, p2.z - this.camZ);
      this.trailingPlayer = d1 > d2 ? 1 : 2;
    }
  }
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}
