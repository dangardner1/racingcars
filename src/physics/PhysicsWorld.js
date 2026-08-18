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

  world.addContactMaterial(
    new CANNON.ContactMaterial(groundMaterial, carMaterial, {
      friction: 0.9,
      restitution: 0.1,
    })
  );

  return { world, groundMaterial, carMaterial };
}

export function stepPhysics(world, dt) {
  world.step(FIXED_STEP, dt, 10);
}
