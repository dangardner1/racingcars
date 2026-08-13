import * as CANNON from 'cannon-es';
import { Car } from './Car.js';

/** Builds a Car from a carDefs.js entry, translating its stat block into
 * the color/chassisSize/wheelBase/mass options Car.js expects. */
export function createCarFromDef(world, carMaterial, scene, def, x, y = 1.5) {
  const car = new Car(world, carMaterial, scene, {
    position: new CANNON.Vec3(x, y, 0),
    color: def.color,
    chassisSize: def.chassisSize,
    wheelBase: def.wheelBase,
    mass: def.mass,
    topSpeed: def.topSpeed,
  });
  car.def = def;
  return car;
}
