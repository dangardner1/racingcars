import * as CANNON from 'cannon-es';
import { Car } from './Car.js';

/**
 * Builds a Car from a carDefs.js entry, translating its stat block into the
 * color/chassisSize/wheelBase/mass options Car.js expects. `spawn` is
 * `{position: {x,y,z}, quaternion}` — a world point plus a full orientation
 * (belly-parallel to the local road surface), typically sampled from the
 * track's path so the car starts facing the direction of travel and
 * matching any slope there.
 */
export function createCarFromDef(world, carMaterial, scene, def, spawn) {
  const { position, quaternion } = spawn;
  const car = new Car(world, carMaterial, scene, {
    position: new CANNON.Vec3(position.x, position.y, position.z),
    quaternion,
    color: def.color,
    chassisSize: def.chassisSize,
    wheelBase: def.wheelBase,
    mass: def.mass,
    topSpeed: def.topSpeed,
  });
  car.def = def;
  return car;
}
