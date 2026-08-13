import * as CANNON from 'cannon-es';
import { FIXED_STEP } from './PhysicsWorld.js';

const WHEEL_RADIUS = 0.45;
const WHEEL_THICKNESS = 0.35;
const MAX_MOTOR_FORCE = 9;
const LEAN_TORQUE = 40;
// Auto-level PD controller: counters wheel-motor reaction torque that would
// otherwise pitch the chassis into an uncontrolled wheelie/flip on flat
// ground. Steer input still overrides this so players can lean into jumps.
const LEVEL_SPRING = 26;
const LEVEL_DAMP = 9;
// Flip-recovery safety net: a crash can still land the car fully upside
// down resting on its roof, where wheels lose ground contact and the
// leveling torque alone can't overcome static contact friction. If the car
// stays flipped and roughly stationary for this long, pop it back over.
const FLIP_ANGLE_THRESHOLD = (60 * Math.PI) / 180;
const STUCK_TIME_TO_RECOVER = 0.5;
const RECOVERY_COOLDOWN = 1.0;

/**
 * Builds a 2-wheel, plane-locked arcade car (Hill-Climb-Racing style),
 * not a RaycastVehicle: rotation is restricted to the Z axis and translation
 * to the X/Y plane so the car stays framed by a fixed side-view camera while
 * still using full physics collision against 3D track geometry.
 */
export function createCarPhysics(world, carMaterial, options = {}) {
  const {
    position = new CANNON.Vec3(0, 2, 0),
    chassisSize = new CANNON.Vec3(1.3, 0.4, 0.7),
    wheelBase = 1.8,
    mass = 40,
    wheelMass = 2,
    topSpeed = 14,
  } = options;
  // Target wheel angular velocity for `topSpeed` m/s of ground speed at full
  // throttle (v = ω·r). Previously hardcoded, which meant every car had the
  // same ~9 m/s ceiling regardless of its topSpeed stat.
  const motorAngularSpeed = topSpeed / WHEEL_RADIUS;

  const chassisBody = new CANNON.Body({
    mass,
    position: position.clone(),
    material: carMaterial,
    linearDamping: 0.05,
    angularDamping: 0.8,
    allowSleep: false,
  });
  chassisBody.addShape(
    new CANNON.Box(chassisSize),
    new CANNON.Vec3(0, chassisSize.y * 0.35, 0)
  );
  // Plane-locked 2.5D trick: only X/Y translation, only Z rotation.
  chassisBody.linearFactor.set(1, 1, 0);
  chassisBody.angularFactor.set(0, 0, 1);
  world.addBody(chassisBody);

  const wheelShape = new CANNON.Cylinder(WHEEL_RADIUS, WHEEL_RADIUS, WHEEL_THICKNESS, 16);
  const wheelQuat = new CANNON.Quaternion();
  wheelQuat.setFromEuler(Math.PI / 2, 0, 0);

  function makeWheel(xOffset) {
    const wheelBody = new CANNON.Body({
      mass: wheelMass,
      material: carMaterial,
      position: new CANNON.Vec3(
        position.x + xOffset,
        position.y - 0.1,
        position.z
      ),
      linearDamping: 0.1,
      angularDamping: 0.3,
      allowSleep: false,
    });
    wheelBody.addShape(wheelShape, new CANNON.Vec3(), wheelQuat);
    world.addBody(wheelBody);

    const constraint = new CANNON.HingeConstraint(chassisBody, wheelBody, {
      pivotA: new CANNON.Vec3(xOffset, -0.15, 0),
      pivotB: new CANNON.Vec3(0, 0, 0),
      axisA: new CANNON.Vec3(0, 0, 1),
      axisB: new CANNON.Vec3(0, 0, 1),
      collideConnected: false,
    });
    constraint.enableMotor();
    world.addConstraint(constraint);

    return { body: wheelBody, constraint };
  }

  const rearWheel = makeWheel(-wheelBase / 2);
  const frontWheel = makeWheel(wheelBase / 2);
  const wheels = [rearWheel, frontWheel];

  let stuckTimer = 0;
  let recoveryCooldown = 0;

  function applyInput({ throttle, brake, steer, handbrake }) {
    const drive = throttle - brake;
    for (const wheel of wheels) {
      if (handbrake) {
        wheel.constraint.setMotorSpeed(0);
        wheel.constraint.setMotorMaxForce(MAX_MOTOR_FORCE * 3);
      } else if (drive !== 0) {
        wheel.constraint.setMotorSpeed(drive * motorAngularSpeed);
        wheel.constraint.setMotorMaxForce(MAX_MOTOR_FORCE);
      } else {
        wheel.constraint.setMotorMaxForce(0.5);
        wheel.constraint.setMotorSpeed(0);
      }
    }

    // Pure-Z-rotation quaternion: angle = 2*atan2(z, w), already in (-pi, pi].
    const q = chassisBody.quaternion;
    const angle = 2 * Math.atan2(q.z, q.w);
    const angularVelZ = chassisBody.angularVelocity.z;

    // A car riding a full loop hazard needs to rotate freely through a full
    // 360° — the auto-level spring (which always pulls toward "wheels down
    // in world space") and the flip-recovery kick (which treats a tilted,
    // near-stationary car as stuck) would both fight that legitimate
    // rotation. Track.js sets this flag via a collide listener on the loop
    // body; consumed and cleared here so it reflects "touched last step".
    const onLoopSurface = chassisBody.userData?.touchingLoop === true;
    if (chassisBody.userData) chassisBody.userData.touchingLoop = false;

    if (steer !== 0) {
      chassisBody.applyTorque(new CANNON.Vec3(0, 0, steer * LEAN_TORQUE));
    } else if (!onLoopSurface) {
      // Pendulum-style restoring torque (uses sin of the angle, not the raw
      // angle) so it keeps pushing toward level all the way from a hard
      // lean, not just near-level jitter.
      const correctiveTorque = -LEVEL_SPRING * Math.sin(angle) - LEVEL_DAMP * angularVelZ;
      chassisBody.applyTorque(new CANNON.Vec3(0, 0, correctiveTorque));
    }

    recoveryCooldown = Math.max(0, recoveryCooldown - FIXED_STEP);
    const speed = chassisBody.velocity.length();
    const angSpeed = Math.abs(angularVelZ);
    const isFlippedAndStill =
      !onLoopSurface && Math.abs(angle) > FLIP_ANGLE_THRESHOLD && speed < 1.5 && angSpeed < 1.5;

    if (recoveryCooldown <= 0 && isFlippedAndStill) {
      stuckTimer += FIXED_STEP;
    } else if (recoveryCooldown <= 0) {
      stuckTimer = 0;
    }

    if (stuckTimer >= STUCK_TIME_TO_RECOVER) {
      const dir = angle >= 0 ? -1 : 1;
      chassisBody.angularVelocity.z = dir * 8;
      chassisBody.velocity.y += 4;
      stuckTimer = 0;
      recoveryCooldown = RECOVERY_COOLDOWN;
    }
  }

  return { chassisBody, wheels, applyInput, wheelBase };
}
