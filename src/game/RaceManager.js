/**
 * Reconciles the two ways a round can end: all-but-one eliminated, or any
 * car completing a full lap of the figure-eight first (its `lapProgress` —
 * a monotonically increasing unwrap of the path's 0..totalLength progress,
 * see Car.updateTrackProgress — reaching the path's total length).
 * Whichever happens first wins the round; everyone else is still ranked
 * afterward so track progress matters even for cars that didn't trigger the
 * end condition themselves.
 */
export class RaceManager {
  constructor(entries, waypoints) {
    // entries: [{ car, name }]
    this.entries = entries;
    this.waypoints = waypoints;
    this.eliminationOrder = [];
    this.finished = false;
    this.winnerName = null;
    this.placements = [];
  }

  update() {
    if (this.finished) return;

    for (const e of this.entries) {
      if (e.car.eliminated && !this.eliminationOrder.includes(e)) {
        this.eliminationOrder.push(e);
      }
    }

    const active = this.entries.filter((e) => !e.car.eliminated);

    const finisher = active.find((e) => e.car.lapProgress >= this.waypoints.totalLength);
    if (finisher) {
      this._finish(finisher, active);
      return;
    }

    if (active.length <= 1) {
      this._finish(active[0] ?? null, active);
    }
  }

  _finish(winnerEntry, activeEntries) {
    this.finished = true;
    this.winnerName = winnerEntry?.name ?? null;

    const others = activeEntries.filter((e) => e !== winnerEntry);
    others.sort((a, b) => b.car.lapProgress - a.car.lapProgress);
    // Eliminated cars rank by elimination order: surviving longer (later
    // elimination) is a better placement than being knocked out early.
    const eliminatedRanked = [...this.eliminationOrder].reverse();

    this.placements = [winnerEntry, ...others, ...eliminatedRanked]
      .filter(Boolean)
      .map((e) => e.name);
  }
}
