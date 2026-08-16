import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

/** Closest point on segment a-b to point p. Returns {t, point, distSq}. */
function closestPointOnSegment(p, a, b) {
  const ab = new THREE.Vector3().subVectors(b, a);
  const lenSq = ab.lengthSq();
  const t = lenSq > 1e-8 ? THREE.MathUtils.clamp(new THREE.Vector3().subVectors(p, a).dot(ab) / lenSq, 0, 1) : 0;
  const point = new THREE.Vector3().copy(a).addScaledVector(ab, t);
  return { t, point, distSq: point.distanceToSquared(p) };
}

/**
 * The track's centerline: an ordered, closed loop of nodes forming the
 * drivable line. A car's progress is tracked by *position in this ordered
 * list*, not by raw world position — that's what keeps a figure-eight's
 * self-crossing unambiguous. locate() only searches a small window of
 * nodes around the caller's last known index (not the whole path) and
 * scores candidates by full 3D distance, so a car in a tunnel and a car on
 * the bridge directly above it — same XZ, different Y, far apart in the
 * node list — are never confused with each other.
 */
export class Waypoints {
  constructor(nodes) {
    this.points = nodes.map((n) => new THREE.Vector3(n.x, n.y ?? 0, n.z ?? 0));
    const n = this.points.length;
    this.cumulative = [0];
    for (let i = 1; i < n; i++) {
      this.cumulative.push(this.cumulative[i - 1] + this.points[i - 1].distanceTo(this.points[i]));
    }
    this.closingLength = this.points[n - 1].distanceTo(this.points[0]);
    this.totalLength = this.cumulative[n - 1] + this.closingLength;
  }

  /** Start/end points and length of the segment beginning at `index` (wraps for the last node). */
  segment(index) {
    const n = this.points.length;
    const a = this.points[index];
    const b = this.points[(index + 1) % n];
    const segLen = index === n - 1 ? this.closingLength : this.cumulative[index + 1] - this.cumulative[index];
    return { a, b, segLen };
  }

  /**
   * Nearest point on the path to `position`, searched only within `window`
   * nodes of `hintIndex` in either direction. Returns
   * {index, progress, point, tangent}, where `progress` is arc-length from
   * the start of the path (0..totalLength).
   */
  locate(position, hintIndex = 0, window = 20) {
    const n = this.points.length;
    let bestIndex = ((hintIndex % n) + n) % n;
    let bestDistSq = Infinity;
    let bestT = 0;

    for (let offset = -window; offset <= window; offset++) {
      const i = (((hintIndex + offset) % n) + n) % n;
      const { a, b, segLen } = this.segment(i);
      const { t, point, distSq } = closestPointOnSegment(position, a, b);
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        bestIndex = i;
        bestT = t;
      }
      void segLen;
    }

    const { a, b, segLen } = this.segment(bestIndex);
    const point = new THREE.Vector3().copy(a).lerp(b, bestT);
    const tangent = new THREE.Vector3().subVectors(b, a).normalize();
    const progress = this.cumulative[bestIndex] + segLen * bestT;
    return { index: bestIndex, progress, point, tangent };
  }

  /** World point + tangent at arc-length `s` along the closed loop (wraps). */
  sampleAtS(s) {
    const target = ((s % this.totalLength) + this.totalLength) % this.totalLength;
    const n = this.points.length;
    let i = 0;
    while (i < n - 1 && this.cumulative[i + 1] <= target) i++;
    const { a, b, segLen } = this.segment(i);
    const segStart = this.cumulative[i];
    const t = segLen > 1e-6 ? (target - segStart) / segLen : 0;
    const point = new THREE.Vector3().copy(a).lerp(b, t);
    const tangent = new THREE.Vector3().subVectors(b, a).normalize();
    return { index: i, point, tangent };
  }

  /** Perpendicular (rightward, in the XZ ground plane) of a tangent vector. */
  static lateral(tangent) {
    return new THREE.Vector3().crossVectors(tangent, UP).normalize();
  }

  /**
   * A world orientation whose local +X faces `tangent` and local +Y is
   * "up" relative to that tangent's own slope (not world-up) — belly-
   * parallel to the road surface a car standing at that tangent would be
   * on, matching pitch on hills instead of just yaw. Returns a plain
   * {x,y,z,w} so callers don't need a THREE/CANNON-specific type.
   */
  static levelQuaternion(tangent) {
    const right = Waypoints.lateral(tangent);
    const up = new THREE.Vector3().crossVectors(right, tangent).normalize();
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(tangent, up, right));
    return { x: q.x, y: q.y, z: q.z, w: q.w };
  }
}
