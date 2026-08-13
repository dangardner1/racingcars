// One-off generator for track02-track10.json. Run with `node scripts/generate-tracks.mjs`.
// Not part of the runtime game — just a way to author 9 structurally-varied
// tracks consistently instead of hand-typing near-duplicate JSON blobs.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'tracks');

const THEMES = [
  { file: 'track02', id: 'track02', theme: 'volcano', sky: '#c94e2d', fog: '#a03a24', ground: '#4a2318',
    rampAngle: 22, pitDamage: 32, bridgeHits: 2, platformAmp: 3, platformPeriod: 2.2 },
  { file: 'track03', id: 'track03', theme: 'ice_glacier', sky: '#bfe6f5', fog: '#d8f0fa', ground: '#e8f6fb',
    rampAngle: 14, pitDamage: 22, bridgeHits: 3, platformAmp: 2, platformPeriod: 3.2 },
  { file: 'track04', id: 'track04', theme: 'neon_city', sky: '#1a1030', fog: '#241640', ground: '#2c2c3a',
    rampAngle: 20, pitDamage: 28, bridgeHits: 2, platformAmp: 2.8, platformPeriod: 2.0 },
  { file: 'track05', id: 'track05', theme: 'junkyard', sky: '#8a8a6a', fog: '#75755a', ground: '#5a4f3a',
    rampAngle: 24, pitDamage: 26, bridgeHits: 2, platformAmp: 2.2, platformPeriod: 2.6 },
  { file: 'track06', id: 'track06', theme: 'jungle_ruins', sky: '#3f7d4a', fog: '#2f6238', ground: '#4a3a24',
    rampAngle: 18, pitDamage: 27, bridgeHits: 3, platformAmp: 2.5, platformPeriod: 2.8 },
  { file: 'track07', id: 'track07', theme: 'construction_site', sky: '#d9c27a', fog: '#c9b164', ground: '#8a7a52',
    rampAngle: 26, pitDamage: 30, bridgeHits: 2, platformAmp: 3.2, platformPeriod: 2.4 },
  { file: 'track08', id: 'track08', theme: 'space_station', sky: '#0a0a1a', fog: '#12122a', ground: '#3a3a4e',
    rampAngle: 16, pitDamage: 24, bridgeHits: 2, platformAmp: 3.5, platformPeriod: 3.6 },
  { file: 'track09', id: 'track09', theme: 'storm_coast', sky: '#4a5a66', fog: '#3a4852', ground: '#425058',
    rampAngle: 20, pitDamage: 29, bridgeHits: 2, platformAmp: 2.6, platformPeriod: 2.1 },
  { file: 'track10', id: 'track10', theme: 'haunted_circuit', sky: '#241a2e', fog: '#1a1220', ground: '#2e2438',
    rampAngle: 22, pitDamage: 31, bridgeHits: 2, platformAmp: 3, platformPeriod: 2.5 },
];

function buildTrack(t) {
  const rampX = 60, rampWidth = 14;
  const pitX = 100, pitWidth = 10;
  const bridgeX = 180, bridgeWidth = 16;
  const gap2X = 236, gap2Width = 14;
  const finishX = 390;

  return {
    id: t.id,
    theme: t.theme,
    skyColor: t.sky,
    fogColor: t.fog,
    groundColor: t.ground,
    groundSegments: [
      { type: 'flat', x: -60, width: 120 },
      { type: 'flat', x: rampX, width: 40 },
      { type: 'gap', x: pitX, width: pitWidth },
      { type: 'flat', x: 110, width: 70 },
      { type: 'crumblingBridge', x: bridgeX, width: bridgeWidth, collapseAfterHits: t.bridgeHits },
      { type: 'flat', x: bridgeX + bridgeWidth, width: 40 },
      { type: 'gap', x: gap2X, width: gap2Width },
      { type: 'flat', x: gap2X + gap2Width, width: 150 },
    ],
    features: [
      { type: 'ramp', x: rampX, width: rampWidth, angle: t.rampAngle },
    ],
    hazards: [
      { type: 'spikePit', x: pitX, width: pitWidth, damage: t.pitDamage },
      { type: 'movingPlatform', x: gap2X, width: 6, amplitude: t.platformAmp, period: t.platformPeriod, axis: 'y' },
    ],
    waypoints: [
      { x: -60, y: 0 },
      { x: rampX, y: 0 },
      { x: rampX + rampWidth, y: rampWidth * Math.tan((t.rampAngle * Math.PI) / 180) },
      { x: pitX, y: 4 },
      { x: 110, y: 0 },
      { x: bridgeX, y: 0 },
      { x: bridgeX + bridgeWidth, y: 0 },
      { x: gap2X, y: 0 },
      { x: gap2X + gap2Width, y: 0 },
      { x: finishX + 10, y: 0 },
    ],
    finishLine: finishX,
    startPositions: Array.from({ length: 11 }, (_, i) => ({ x: -58 + i * 4, lane: i })),
  };
}

for (const t of THEMES) {
  const data = buildTrack(t);
  writeFileSync(path.join(outDir, `${t.file}.json`), JSON.stringify(data, null, 2) + '\n');
  console.log('wrote', t.file);
}
