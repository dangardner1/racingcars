import * as CANNON from 'cannon-es';

export const FIXED_STEP = 1 / 60;

export function createPhysicsWorld() {
  const world = new CANNON.World({
    gravity: new CANNON.Vec3(0, -9.82, 0),
  });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = true;

  const groundMaterial = new CANNON.Material('ground');
  const carMaterial = new CANNON.Material('car');
  const loopMaterial = new CANNON.Material('loop');

  world.addContactMaterial(
    new CANNON.ContactMaterial(groundMaterial, carMaterial, {
      friction: 0.9,
      restitution: 0.1,
    })
  );
  // Lower-friction surface for the loop hazard so a car doesn't bleed as
  // much speed climbing it — full ground grip would make most cars fall
  // short of the speed a loop-the-loop needs to complete.
  world.addContactMaterial(
    new CANNON.ContactMaterial(loopMaterial, carMaterial, {
      friction: 0.25,
      restitution: 0.05,
    })
  );

  return { world, groundMaterial, carMaterial, loopMaterial };
}

export function stepPhysics(world, dt) {
  world.step(FIXED_STEP, dt, 10);
}
