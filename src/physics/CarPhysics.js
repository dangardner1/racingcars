import * as CANNON from 'cannon-es';

const WHEEL_RADIUS = 0.4;
const MAX_STEER = 0.62; // radians (~35.5deg) at a dead stop, eased down at high speed
const STEER_SPEED_FALLOFF = 0.55; // fraction of MAX_STEER shed by the time the car hits topSpeed
const STEER_RATE = 8; // rad/sec the wheel angle can move — keyboard input is on/off, this is what keeps it from snapping to full lock in one frame
const WORLD_UP = new CANNON.Vec3(0, 1, 0);

// Flip-recovery safety net: a crash can land the car fully upside down,
// resting on its roof where wheel raycasts never hit the ground and normal
// driving forces can't right it. If the car stays flipped and roughly
// stationary this long, pop it back over.
const FLIP_UP_DOT_THRESHOLD = 0.2; // world-up . chassis-up; <0 means fully inverted
const STUCK_TIME_TO_RECOVER = 0.6;
const RECOVERY_COOLDOWN = 1.0;

/**
 * Builds a 4-wheel `CANNON.RaycastVehicle` — real front-wheel steering, and
 * raycast suspension that naturally follows hill slopes and bridge/tunnel
 * decks instead of needing the road to be flat. Local chassis axes match
 * RaycastVehicle's default convention (and carDefs.js's chassisSize
 * [x,y,z]): local +X forward, +Y up, +Z right.
 */
export function createCarPhysics(world, carMaterial, options = {}) {
  const {
    position = new CANNON.Vec3(0, 2, 0),
    // Full orientation (not just a yaw angle) so a car spawned on a slope
    // starts belly-parallel to the road surface instead of level — a
    // yaw-only spawn left 1-3 wheels dangling off an unmatched slope,
    // which dumped the car's whole weight onto a single wheel and threw it
    // into a violent spin on the very first physics step.
    quaternion = new CANNON.Quaternion(0, 0, 0, 1),
    chassisSize = new CANNON.Vec3(1.3, 0.4, 0.7),
    wheelBase = 1.8,
    mass = 40,
    topSpeed = 14,
  } = options;

  const chassisBody = new CANNON.Body({
    mass,
    position: position.clone(),
    material: carMaterial,
    linearDamping: 0.05,
    angularDamping: 0.5,
    allowSleep: false,
  });
  // Shape offset stays at the body origin (not raised) so the physics
  // center of mass sits low, near axle height — a raised offset made the
  // free-rotating chassis top-heavy and prone to flipping when only one
  // wheel caught the ground first.
  chassisBody.addShape(new CANNON.Box(chassisSize), new CANNON.Vec3(0, 0, 0));
  chassisBody.quaternion.copy(quaternion);

  const vehicle = new CANNON.RaycastVehicle({ chassisBody });

  const trackWidth = chassisSize.z * 1.9;
  const wheelY = -chassisSize.y * 0.9;
  const wheelOptions = {
    radius: WHEEL_RADIUS,
    directionLocal: new CANNON.Vec3(0, -1, 0),
    axleLocal: new CANNON.Vec3(0, 0, 1),
    suspensionRestLength: 0.4,
    suspensionStiffness: 18,
    dampingRelaxation: 5,
    dampingCompression: 7,
    maxSuspensionForce: 1e5,
    maxSuspensionTravel: 0.3,
    frictionSlip: 5.5,
    rollInfluence: 0.05,
  };

  // Wheel indices: 0 front-left, 1 front-right, 2 rear-left, 3 rear-right.
  const connectionPoints = [
    new CANNON.Vec3(wheelBase / 2, wheelY, trackWidth / 2),
    new CANNON.Vec3(wheelBase / 2, wheelY, -trackWidth / 2),
    new CANNON.Vec3(-wheelBase / 2, wheelY, trackWidth / 2),
    new CANNON.Vec3(-wheelBase / 2, wheelY, -trackWidth / 2),
  ];
  for (const chassisConnectionPointLocal of connectionPoints) {
    vehicle.addWheel({ ...wheelOptions, chassisConnectionPointLocal, isFrontWheel: chassisConnectionPointLocal.x > 0 });
  }
  vehicle.addToWorld(world);

  // Applied to BOTH rear wheels each frame (not split between them), so the
  // combined force is 2x this. mass*7 (560N combined for a 40kg car) was
  // enough to pop an uncontrollable, ever-climbing wheelie off a dead
  // stop — the rear-wheel drive force applied at ground level, well below
  // the chassis's center of mass, pitches the nose up, and with no
  // anti-wheelie limit it just kept climbing past vertical.
  const maxEngineForce = mass * 2.1;
  const maxBrakeForce = maxEngineForce * 2;

  let stuckTimer = 0;
  let recoveryCooldown = 0;
  let currentSteerAngle = 0;

  function forwardSpeed() {
    const forward = chassisBody.vectorToWorldFrame(new CANNON.Vec3(1, 0, 0), new CANNON.Vec3());
    return chassisBody.velocity.dot(forward);
  }

  function applyInput({ throttle, brake, steer, handbrake }) {
    // world.dt defaults to -1 before the first world.step() call; guard so
    // the rate limiters below don't see a negative/nonsensical dt on the
    // very first physics step of a race.
    const dt = world.dt > 0 ? world.dt : 1 / 60;
    const speed = forwardSpeed();
    const speedT = Math.min(1, Math.abs(speed) / Math.max(1, topSpeed));
    const targetSteerAngle = MAX_STEER * (1 - STEER_SPEED_FALLOFF * speedT) * steer;
    // Ease the wheel angle toward the target instead of snapping to it —
    // keyboard input is a hard on/off, so without this a tap of A/D would
    // slam the front wheels to full lock in a single physics step, which
    // reads as twitchy/oversensitive and can kick the rear out.
    const maxDelta = STEER_RATE * dt;
    currentSteerAngle += Math.max(-maxDelta, Math.min(maxDelta, targetSteerAngle - currentSteerAngle));
    vehicle.setSteeringValue(currentSteerAngle, 0);
    vehicle.setSteeringValue(currentSteerAngle, 1);

    const drive = throttle - brake;
    const engineForce = drive !== 0 && Math.abs(speed) < topSpeed ? drive * maxEngineForce : 0;
    vehicle.applyEngineForce(handbrake ? 0 : engineForce, 2);
    vehicle.applyEngineForce(handbrake ? 0 : engineForce, 3);
    vehicle.applyEngineForce(0, 0);
    vehicle.applyEngineForce(0, 1);

    const brakeForce = handbrake ? maxBrakeForce : drive === 0 ? maxEngineForce * 0.15 : 0;
    for (let i = 0; i < 4; i++) vehicle.setBrake(i >= 2 ? brakeForce : brakeForce * 0.5, i);

    // A car riding a full loop hazard needs to rotate freely through a full
    // 360° — flip-recovery (which treats a tilted, near-stationary car as
    // stuck) would otherwise fight that legitimate rotation. Track.js sets
    // this flag via a collide listener on the loop body; consumed and
    // cleared here so it reflects "touched last step".
    const onLoopSurface = chassisBody.userData?.touchingLoop === true;
    if (chassisBody.userData) chassisBody.userData.touchingLoop = false;

    const airborne = vehicle.numWheelsOnGround === 0;
    const worldUp = chassisBody.quaternion.vmult(new CANNON.Vec3(0, 1, 0));
    const upDot = worldUp.dot(WORLD_UP);

    // Gentle airborne stabilization so a jump doesn't turn into an
    // uncontrolled tumble — nudges (doesn't snap) the chassis level.
    if (airborne && !onLoopSurface) {
      const correction = worldUp.cross(WORLD_UP).scale(2.5);
      chassisBody.angularVelocity.x += correction.x * 0.15;
      chassisBody.angularVelocity.z += correction.z * 0.15;
    }

    recoveryCooldown = Math.max(0, recoveryCooldown - dt);
    const angSpeed = chassisBody.angularVelocity.length();
    const isFlippedAndStill = !onLoopSurface && upDot < FLIP_UP_DOT_THRESHOLD && Math.abs(speed) < 1.5 && angSpeed < 1.5;

    if (recoveryCooldown <= 0 && isFlippedAndStill) {
      stuckTimer += dt;
    } else if (recoveryCooldown <= 0) {
      stuckTimer = 0;
    }

    if (stuckTimer >= STUCK_TIME_TO_RECOVER) {
      const correction = worldUp.cross(WORLD_UP);
      correction.normalize();
      chassisBody.angularVelocity.copy(correction.scale(6));
      chassisBody.velocity.y += 4;
      stuckTimer = 0;
      recoveryCooldown = RECOVERY_COOLDOWN;
    }
  }

  return { chassisBody, vehicle, applyInput, wheelBase, wheelRadius: WHEEL_RADIUS };
}
