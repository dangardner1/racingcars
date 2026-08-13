const MIN_IMPACT_VELOCITY = 3; // scrapes below this don't count as damage
const VELOCITY_TO_DAMAGE = 3.5;
const MAX_DAMAGE_PER_HIT = 35;

/**
 * Converts chassis collisions into damage events. Impact severity is derived
 * from relative velocity along the contact normal, so a gentle nudge from
 * another car doesn't hurt but a head-on wall hit does.
 */
export function attachCollisionDamage(chassisBody, damageSystem, onImpact) {
  chassisBody.addEventListener('collide', (event) => {
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
