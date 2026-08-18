/**
 * Shared elevated top-down/three-quarter camera for 2 local players (chosen
 * over split-screen — with 3 AI cars also on screen, halving screen space
 * would make hazards/opponents too hard to read). Frames the midpoint of
 * both human players and zooms out as they separate.
 *
 * The camera sits at a fixed world-space offset above and behind the
 * tracked point — it does not rotate to follow either player's heading.
 * That keeps a figure-eight (which doubles back on itself) and elevation
 * changes (hills/tunnels/bridges) easy to read without the extra
 * complexity/disorientation of a heading-following chase camera.
 *
 * Zoom-out distance is derived directly from the camera's actual FOV/aspect
 * and the players' real XZ separation (not a hand-tuned fixed cap) — a
 * fixed cap previously left both players outside the camera's frustum
 * entirely once they separated far enough, since the cap's zoom-out
 * distance was well short of what the FOV geometry actually needed to fit
 * that much spread on screen.
 */
const BASE_HEIGHT = 28;
const BASE_BACK = 20; // fixed world +Z offset behind the framed point when players are close together
const HEIGHT_TO_BACK_RATIO = BASE_HEIGHT / BASE_BACK; // keeps the same downward tilt angle at every zoom level
const FRAME_MARGIN = 1.4; // headroom above the bare-minimum FOV fit, so a car isn't pinned to the screen edge
const SMOOTHING = 4; // higher = snappier follow

const SHAKE_DECAY = 3.5; // trauma units/sec

export class TopDownCamera {
  constructor(camera) {
    this.camera = camera;
    this.camX = 0;
    this.camY = 0;
    this.camZ = 0;
    this.back = BASE_BACK; // smoothed camera distance; height is derived from this each frame
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

    // Required camera-to-target distance so BOTH the vertical and
    // (aspect-scaled) horizontal FOV comfortably contain the full spread —
    // the tighter of the two axes wins, so a narrow/portrait viewport
    // doesn't leave a player off the side even though they'd fit vertically.
    const halfFovY = (this.camera.fov * Math.PI) / 180 / 2;
    const tanY = Math.tan(halfFovY);
    const tanX = tanY * this.camera.aspect;
    const limitingTan = Math.min(tanX, tanY);
    const requiredSlant = spread > 0 ? (spread * FRAME_MARGIN) / (2 * limitingTan) : 0;
    const slantPerBack = Math.sqrt(HEIGHT_TO_BACK_RATIO * HEIGHT_TO_BACK_RATIO + 1);
    const requiredBack = requiredSlant / slantPerBack;
    const targetBack = Math.max(BASE_BACK, requiredBack);

    const lerpFactor = 1 - Math.exp(-SMOOTHING * dt);
    this.camX += (midX - this.camX) * lerpFactor;
    this.camY += (midY - this.camY) * lerpFactor;
    this.camZ += (midZ - this.camZ) * lerpFactor;
    this.back += (targetBack - this.back) * lerpFactor;

    const back = this.back;
    const height = back * HEIGHT_TO_BACK_RATIO;

    this.trauma = Math.max(0, this.trauma - SHAKE_DECAY * dt);
    const shake = this.trauma * this.trauma; // squared falloff: sharp punch, quick settle
    const shakeX = (Math.random() * 2 - 1) * shake * 1.2;
    const shakeZ = (Math.random() * 2 - 1) * shake * 1.2;

    this.camera.position.set(this.camX + shakeX, this.camY + height, this.camZ + back + shakeZ);
    this.camera.lookAt(this.camX, this.camY, this.camZ);
  }
}
