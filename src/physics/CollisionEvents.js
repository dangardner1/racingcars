const MIN_IMPACT_VELOCITY = 3; // scrapes below this don't count as damage
const VELOCITY_TO_DAMAGE = 3.5;
const MAX_DAMAGE_PER_HIT = 35;

/**
 * Converts chassis collisions into damage events. Impact severity is derived
 * from relative velocity along the contact normal, so a gentle nudge from
 * another car doesn't hurt but a head-on hit does.
 *
 * `wallShapes` (Track.js's `railShapes` set — guardrails and tunnel walls)
 * is exempted entirely: hitting a wall already bounces the car and nudges
 * its heading back toward the track (Track.js's wallBounceTangent), and
 * that's meant to read as a forgiving boundary, not a hazard — stacking
 * damage on top of it made clipping a guardrail feel like a punishment for
 * driving near the edge rather than a soft correction. Car-vs-car impacts
 * (no shape involved, just two chassis bodies) still damage normally —
 * that crash-into-each-other exchange is the core of the game.
 */
export function attachCollisionDamage(chassisBody, damageSystem, onImpact, wallShapes) {
  chassisBody.addEventListener('collide', (event) => {
    if (wallShapes) {
      const contact = event.contact;
      const otherShape = contact.bi === chassisBody ? contact.sj : contact.si;
      if (wallShapes.has(otherShape)) return;
    }
    const impactVelocity = Math.abs(event.contact.getImpactVelocityAlongNormal());
    if (impactVelocity < MIN_IMPACT_VELOCITY) return;
    const damage = Math.min(
      MAX_DAMAGE_PER_HIT,
      (impactVelocity - MIN_IMPACT_VELOCITY) * VELOCITY_TO_DAMAGE
    );
    damageSystem.applyDamage(damage);
    onImpact?.(damage);
  });
}

/** Applies flat, velocity-independent damage — used for hazards like spike pits. */
export function applyHazardDamage(damageSystem, amount) {
  damageSystem.applyDamage(amount);
}
