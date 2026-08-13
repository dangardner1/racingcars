import { rubberBandMultiplier } from './RubberBand.js';

/**
 * Waypoint-following AI: no pathfinding needed since tracks are linear
 * side-scrollers. Each tick it decides throttle/brake to hold a target
 * speed (adjusted by rubber-banding against the leading human) and leaves
 * steer to the car's own auto-level system except when badly tilted.
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
    const myProgress = this.waypoints.progressForX(body.position.x);
    const leaderProgress = getLeaderProgress();
    const targetSpeed = this.baseSpeed * rubberBandMultiplier(myProgress, leaderProgress);

    const currentSpeed = body.velocity.x;
    let throttle = 0;
    let brake = 0;
    if (currentSpeed < targetSpeed - 0.5) {
      throttle = 1;
    } else if (currentSpeed > targetSpeed + 0.5) {
      brake = 0.4;
    } else {
      throttle = 0.5;
    }

    // Correct hard tilts manually (auto-level handles the rest); AI "skill"
    // determines how promptly it reacts to being knocked off-balance.
    let steer = 0;
    const q = body.quaternion;
    const angle = 2 * Math.atan2(q.z, q.w);
    if (Math.abs(angle) > 0.5 * (1.2 - this.skill)) {
      steer = angle > 0 ? -1 : 1;
    }

    return { throttle, brake, steer, handbrake: false };
  }
}
