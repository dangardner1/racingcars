/**
 * A waypoint path is just an ordered list of {x, y} points along a track's
 * centerline. Used both for AI steering targets and for progress/placement
 * tracking (a car's "distance along track" is measured against this path).
 */
export class Waypoints {
  constructor(points) {
    this.points = points;
  }

  /** Index of the last waypoint the given x position has passed. */
  segmentIndexForX(x) {
    let i = 0;
    while (i < this.points.length - 1 && this.points[i + 1].x <= x) {
      i++;
    }
    return i;
  }

  /** A lookahead target point some distance ahead of the given x position. */
  targetAhead(x, lookahead) {
    const targetX = x + lookahead;
    const idx = this.segmentIndexForX(targetX);
    return this.points[Math.min(idx, this.points.length - 1)];
  }

  /** Approximate progress distance along the track for a given x position. */
  progressForX(x) {
    return Math.max(0, x - this.points[0].x);
  }
}
