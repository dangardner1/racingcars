export const States = {
  MAIN_MENU: 'MAIN_MENU',
  TRACK_SELECT: 'TRACK_SELECT',
  CAR_SELECT: 'CAR_SELECT',
  RACING: 'RACING',
  RESULTS: 'RESULTS',
};

/** Minimal state machine with change listeners; screens subscribe to know
 * when to show/hide themselves rather than polling. */
export class GameState {
  constructor() {
    this.state = States.MAIN_MENU;
    this.listeners = [];
    this.selection = { trackData: null, p1Def: null, p2Def: null };
  }

  set(state) {
    this.state = state;
    for (const fn of this.listeners) fn(state);
  }

  onChange(fn) {
    this.listeners.push(fn);
  }
}
