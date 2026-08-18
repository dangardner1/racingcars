/**
 * 11 distinct car definitions. Visual variety comes purely from color and
 * modest chassis proportion scaling (no external 3D models); physics stays
 * close to the M2-tuned baseline (±20%) so cars stay stable and controllable
 * rather than reintroducing instability chasing bigger stat swings.
 * skill/topSpeed drive AIController behavior for AI-piloted cars (skill
 * scales cornering caution, topSpeed sets the target cruise speed).
 * aggression is a per-car flavor stat only — nothing currently reads it.
 */
export const CAR_DEFS = [
  {
    id: 'bolt', name: 'Bolt', color: 0x2299ee,
    chassisSize: [1.3, 0.4, 0.7], wheelBase: 1.8, mass: 40,
    aggression: 0.5, skill: 0.7, topSpeed: 11.2,
  },
  {
    id: 'ember', name: 'Ember', color: 0xee3333,
    chassisSize: [1.3, 0.4, 0.7], wheelBase: 1.8, mass: 40,
    aggression: 0.5, skill: 0.7, topSpeed: 11.2,
  },
  {
    id: 'sunburst', name: 'Sunburst', color: 0xffcc00,
    chassisSize: [1.45, 0.35, 0.7], wheelBase: 2.0, mass: 36,
    aggression: 0.6, skill: 0.55, topSpeed: 12,
  },
  {
    id: 'clover', name: 'Clover', color: 0x22cc55,
    chassisSize: [1.15, 0.45, 0.72], wheelBase: 1.6, mass: 46,
    aggression: 0.4, skill: 0.8, topSpeed: 10,
  },
  {
    id: 'orchid', name: 'Orchid', color: 0xcc22cc,
    chassisSize: [1.3, 0.42, 0.68], wheelBase: 1.8, mass: 40,
    aggression: 0.55, skill: 0.65, topSpeed: 10.8,
  },
  {
    id: 'rustbucket', name: 'Rustbucket', color: 0x8a5a2a,
    chassisSize: [1.5, 0.5, 0.75], wheelBase: 2.1, mass: 52,
    aggression: 0.8, skill: 0.4, topSpeed: 8.8,
  },
  {
    id: 'glacier', name: 'Glacier', color: 0x66eeff,
    chassisSize: [1.2, 0.38, 0.68], wheelBase: 1.7, mass: 34,
    aggression: 0.35, skill: 0.85, topSpeed: 12.4,
  },
  {
    id: 'inferno', name: 'Inferno', color: 0xff5500,
    chassisSize: [1.35, 0.36, 0.66], wheelBase: 1.9, mass: 33,
    aggression: 0.75, skill: 0.6, topSpeed: 12.8,
  },
  {
    id: 'shadow', name: 'Shadow', color: 0x2a2a2a,
    chassisSize: [1.25, 0.4, 0.7], wheelBase: 1.75, mass: 42,
    aggression: 0.65, skill: 0.6, topSpeed: 10.4,
  },
  {
    id: 'mint', name: 'Mint', color: 0x33ffaa,
    chassisSize: [1.1, 0.4, 0.65], wheelBase: 1.55, mass: 38,
    aggression: 0.3, skill: 0.9, topSpeed: 10.8,
  },
  {
    id: 'goldrush', name: 'Goldrush', color: 0xddaa22,
    chassisSize: [1.4, 0.44, 0.73], wheelBase: 1.95, mass: 48,
    aggression: 0.7, skill: 0.5, topSpeed: 9.6,
  },
];
