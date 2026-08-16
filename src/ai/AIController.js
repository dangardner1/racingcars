import * as CANNON from 'cannon-es';
import { rubberBandMultiplier } from './RubberBand.js';

const STEER_GAIN = 2.2;
const LOOKAHEAD_BASE = 9;
const LOOKAHEAD_SPEED_SCALE = 0.55;
const CURVE_LOOKAHEAD = 18;
const LOCAL_FORWARD = new CANNON.Vec3(1, 0, 0);

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function normalizeAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/**
 * Pursuit-steering AI: picks a lookahead point further along the path and
 * steers toward it, brakes/lifts off the throttle for sharp upcoming turns,
 * and holds a target speed (adjusted by rubber-banding against the leading
 * human) via throttle/brake on the straights.
 */
export class AIController {
  constructor(car, waypoints, options = {}) {
    this.car = car;
    this.waypoints = waypoints;
    this.baseSpeed = options.baseSpeed ?? 14;
    this.skill = options.skill ?? 1; // 0-1, scales cornering/braking care
  }

  update(getLeaderProgress) {
    if (this.car.eliminated) {
      return { throttle: 0, brake: 0, steer: 0, handbrake: true };
    }

    const body = this.car.physics.chassisBody;
    const myLapProgress = this.car.updateTrackProgress(this.waypoints);
    const leaderProgress = getLeaderProgress();

    const carForward = body.vectorToWorldFrame(LOCAL_FORWARD, new CANNON.Vec3());
    const carHeading = Math.atan2(carForward.z, carForward.x);
    const forwardSpeed = body.velocity.dot(carForward);

    const rawProgress = this.car.trackState.progress;
    const lookahead = LOOKAHEAD_BASE + Math.max(0, forwardSpeed) * LOOKAHEAD_SPEED_SCALE;
    const near = this.waypoints.sampleAtS(rawProgress + lookahead);
    const far = this.waypoints.sampleAtS(rawProgress + lookahead + CURVE_LOOKAHEAD);

    const targetHeading = Math.atan2(near.point.z - body.position.z, near.point.x - body.position.x);
    const steer = clamp(normalizeAngle(targetHeading - carHeading) * STEER_GAIN, -1, 1);

    const nearHeading = Math.atan2(near.tangent.z, near.tangent.x);
    const farHeading = Math.atan2(far.tangent.z, far.tangent.x);
    const turnAmount = Math.abs(normalizeAngle(farHeading - nearHeading));
    const curveCaution = 0.5 + 0.5 * (1 - this.skill); // lower skill brakes harder for turns
    const curveSlow = clamp(1 - turnAmount * curveCaution, 0.35, 1);

    const targetSpeed = this.baseSpeed * rubberBandMultiplier(myLapProgress, leaderProgress) * curveSlow;

    let throttle = 0;
    let brake = 0;
    if (forwardSpeed < targetSpeed - 0.5) {
      throttle = 1;
    } else if (forwardSpeed > targetSpeed + 0.5) {
      brake = 0.4;
    } else {
      throttle = 0.5;
    }

    return { throttle, brake, steer, handbrake: false };
  }
}
