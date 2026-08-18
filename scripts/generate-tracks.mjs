// Generator for all 10 track0*.json files. Run with `node scripts/generate-tracks.mjs`.
// Not part of the runtime game — just a way to author 10 structurally
// varied figure-eight tracks consistently instead of hand-typing ~120
// path nodes per track.
//
// Each track's centerline is a lemniscate (figure-eight) curve:
//   x(t) = A*sin(t), z(t) = (A/2)*sin(2t), t in [0, 2*PI)
// which is a single continuous closed loop that passes through the XZ
// origin twice (t=0 and t=PI), at a clean ~90 degree crossing angle. The
// first pass (t=0) is built as a ground-level tunnel; the second pass
// (t=PI) is built as an elevated bridge — so the "figure eight crossing
// itself" is a real, physically-resolved highway-style overpass, not an
// illusion.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'tracks');

const THEMES = [
  { file: 'track01', id: 'track01', theme: 'desert_canyon', sky: '#e8a95c', fog: '#e8a95c', ground: '#8a6338',
    scale: 1.0, hillAmp: 3.5, bridgeHeight: 8.5, pitDamage: 15, bridgeHits: 2, loopRadius: 8, boostSpeed: 26 },
  { file: 'track02', id: 'track02', theme: 'volcano', sky: '#c94e2d', fog: '#a03a24', ground: '#4a2318',
    scale: 1.05, hillAmp: 4.5, bridgeHeight: 9, pitDamage: 16, bridgeHits: 2, loopRadius: 8.5, boostSpeed: 26 },
  { file: 'track03', id: 'track03', theme: 'ice_glacier', sky: '#bfe6f5', fog: '#d8f0fa', ground: '#e8f6fb',
    scale: 0.92, hillAmp: 2.5, bridgeHeight: 7.5, pitDamage: 11, bridgeHits: 3, loopRadius: 7.5, boostSpeed: 24 },
  { file: 'track04', id: 'track04', theme: 'neon_city', sky: '#1a1030', fog: '#241640', ground: '#2c2c3a',
    scale: 1.1, hillAmp: 2, bridgeHeight: 10, pitDamage: 14, bridgeHits: 2, loopRadius: 9, boostSpeed: 27 },
  { file: 'track05', id: 'track05', theme: 'junkyard', sky: '#8a8a6a', fog: '#75755a', ground: '#5a4f3a',
    scale: 0.9, hillAmp: 4, bridgeHeight: 8, pitDamage: 13, bridgeHits: 2, loopRadius: 7, boostSpeed: 25 },
  { file: 'track06', id: 'track06', theme: 'jungle_ruins', sky: '#3f7d4a', fog: '#2f6238', ground: '#4a3a24',
    scale: 1.0, hillAmp: 5, bridgeHeight: 8.5, pitDamage: 14, bridgeHits: 3, loopRadius: 8, boostSpeed: 26 },
  { file: 'track07', id: 'track07', theme: 'construction_site', sky: '#d9c27a', fog: '#c9b164', ground: '#8a7a52',
    scale: 1.05, hillAmp: 3, bridgeHeight: 9.5, pitDamage: 15, bridgeHits: 2, loopRadius: 8.5, boostSpeed: 26 },
  { file: 'track08', id: 'track08', theme: 'space_station', sky: '#0a0a1a', fog: '#12122a', ground: '#3a3a4e',
    scale: 1.15, hillAmp: 1.5, bridgeHeight: 11, pitDamage: 12, bridgeHits: 2, loopRadius: 9.5, boostSpeed: 28 },
  { file: 'track09', id: 'track09', theme: 'storm_coast', sky: '#4a5a66', fog: '#3a4852', ground: '#425058',
    scale: 0.95, hillAmp: 3.5, bridgeHeight: 8, pitDamage: 15, bridgeHits: 2, loopRadius: 7.8, boostSpeed: 26 },
  { file: 'track10', id: 'track10', theme: 'haunted_circuit', sky: '#241a2e', fog: '#1a1220', ground: '#2e2438',
    scale: 1.0, hillAmp: 4, bridgeHeight: 8.5, pitDamage: 16, bridgeHits: 2, loopRadius: 8, boostSpeed: 26 },
];

const N = 120; // path nodes around the whole figure-eight
const WIDTH = 11;
const CROSSING_WINDOW = 0.34; // rad half-width of the tunnel/bridge crossing zone
const CROSSING_SIGMA = 0.16;

// Node-index fractions (of N) for start grid + hazards, chosen to stay
// clear of both crossing windows (~+-7 nodes around index 0 and N/2).
const START_FRAC = 0.15;
const BOOST_FRAC = 0.365;
const LOOP_FRAC = 0.40;
const PIT_FRAC = 0.63;
const CRUMBLE_FRAC = 0.85;

function round2(n) {
  return Math.round(n * 100) / 100;
}

function angularDist(t, center) {
  let d = Math.abs(t - center) % (Math.PI * 2);
  if (d > Math.PI) d = Math.PI * 2 - d;
  return d;
}

function buildTrack(t_) {
  const A = 55 * t_.scale; // lobe half-extent along X

  const path = [];
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    const x = A * Math.sin(t);
    const z = (A / 2) * Math.sin(2 * t);

    const distToTunnel = angularDist(t, 0);
    const distToBridge = angularDist(t, Math.PI);
    const tunnelT = Math.exp(-(distToTunnel * distToTunnel) / (2 * CROSSING_SIGMA * CROSSING_SIGMA));
    const bridgeT = Math.exp(-(distToBridge * distToBridge) / (2 * CROSSING_SIGMA * CROSSING_SIGMA));

    const hill = t_.hillAmp * Math.sin(t * 2.3) * (1 - tunnelT) * (1 - bridgeT);
    const bridgeBump = t_.bridgeHeight * bridgeT;
    const y = Math.max(0, hill) + bridgeBump;

    let type = 'flat';
    if (distToTunnel < CROSSING_WINDOW) type = 'tunnel';
    else if (distToBridge < CROSSING_WINDOW) type = 'bridge';

    path.push({ x: round2(x), y: round2(y), z: round2(z), width: WIDTH, type });
  }

  const idx = (frac) => Math.round(N * frac);
  const loopIdx = idx(LOOP_FRAC);
  const boostIdx = idx(BOOST_FRAC);
  const pitIdx = idx(PIT_FRAC);
  const crumbleIdx = idx(CRUMBLE_FRAC);
  const startIdx = idx(START_FRAC);

  // A spike pit: road stays solid here (guard rails included), spikes
  // just protrude up from the surface and damage on contact — no gap in
  // the track for a car to fall through.
  // A separate at-grade crumbling bridge elsewhere on the loop.
  path[crumbleIdx].type = 'crumblingBridge';
  path[(crumbleIdx + 1) % N].type = 'crumblingBridge';

  return {
    id: t_.id,
    theme: t_.theme,
    skyColor: t_.sky,
    fogColor: t_.fog,
    groundColor: t_.ground,
    path,
    features: [{ type: 'loop', atIndex: loopIdx, radius: t_.loopRadius, segCount: 28 }],
    hazards: [
      { type: 'boostPad', atIndex: boostIdx, spanNodes: 2, speed: t_.boostSpeed },
      { type: 'spikePit', atIndex: pitIdx, spanNodes: 1, damage: t_.pitDamage },
    ],
    startIndex: startIdx,
    startPositions: [{ lane: -2 }, { lane: -1 }, { lane: 0 }, { lane: 1 }, { lane: 2 }],
  };
}

for (const t of THEMES) {
  const data = buildTrack(t);
  writeFileSync(path.join(outDir, `${t.file}.json`), JSON.stringify(data, null, 2) + '\n');
  console.log('wrote', t.file, `(${data.path.length} nodes)`);
}
