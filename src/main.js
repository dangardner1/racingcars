import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import './style.css';
import { createPhysicsWorld, FIXED_STEP } from './physics/PhysicsWorld.js';
import { DamageSystem } from './game/DamageSystem.js';
import { Track } from './game/Track.js';
import { createCarFromDef } from './game/CarFactory.js';
import { RaceManager } from './game/RaceManager.js';
import { GameState, States } from './game/GameState.js';
import { CAR_DEFS } from './cars/carDefs.js';
import { TRACKS } from './tracks/index.js';
import { attachCollisionDamage } from './physics/CollisionEvents.js';
import { readInput, isKeyDown } from './input/InputManager.js';
import { P1_KEYS, P2_KEYS } from './input/KeyBindings.js';
import { AIController } from './ai/AIController.js';
import { Waypoints } from './ai/Waypoints.js';
import { TopDownCamera } from './camera/TopDownCamera.js';
import { createMainMenu } from './ui/MainMenu.js';
import { createTrackSelect } from './ui/TrackSelect.js';
import { createCarSelect } from './ui/CarSelect.js';
import { createHUD } from './ui/HUD.js';
import { createTouchControls } from './ui/TouchControls.js';
import { createHowToPlay } from './ui/HowToPlay.js';
import { createResultsScreen } from './ui/ResultsScreen.js';
import { SoundManager } from './audio/SoundManager.js';

const canvas = document.getElementById('game-canvas');
const uiRoot = document.getElementById('ui-root');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const DEFAULT_BACKGROUND = 0x101018;

const scene = new THREE.Scene();
scene.background = new THREE.Color(DEFAULT_BACKGROUND);
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 600);
camera.position.set(0, 30, 25);

const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(60, 90, 40);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -95;
sun.shadow.camera.right = 95;
sun.shadow.camera.top = 95;
sun.shadow.camera.bottom = -95;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 260;
sun.shadow.bias = -0.0015;
scene.add(sun);

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// --- Race lifecycle -------------------------------------------------------
// `race` holds everything specific to one round; startRace() tears down the
// previous round's scene content/physics world before building a fresh one,
// so "Race Again" and repeated track/car selection don't leak objects.
let race = null;
const soundManager = new SoundManager();
if (import.meta.env.DEV) window.__sound = soundManager;
if (import.meta.env.DEV) window.__input = { isKeyDown, readInput };

const FIELD_SIZE = 5; // 2 human + 3 AI
const LANE_SPACING = 1.8; // keeps the outermost of 5 lanes (+-2) within the 11-wide road
// Matches the wheels' natural at-rest extension (radius + suspension rest
// length, minus the wheel-connection-point offset) so cars spawn with
// wheels already touching, instead of free-falling onto the track and
// catching one corner before the others — which was violently tipping cars
// over on spawn.
const SPAWN_LIFT = 1.16;

function clearSceneForNewRace() {
  for (const child of [...scene.children]) {
    if (child === hemi || child === sun) continue;
    scene.remove(child);
  }
  // startRace() overrides these right after with the new track's own
  // colors; resetting here is what makes onMainMenu's call to this same
  // function actually restore the default look instead of leaving the
  // previous track's sky color/fog showing behind the main menu.
  scene.background = new THREE.Color(DEFAULT_BACKGROUND);
  scene.fog = null;
}

/**
 * World spawn point + orientation for a start-grid lane. The orientation is
 * belly-parallel to the local road slope (not just yawed to face the
 * tangent) so a car spawned on a hill starts flush with all 4 wheels at
 * roughly equal height above the surface, instead of dangling 1-3 wheels
 * off a slope the yaw-only orientation didn't account for.
 */
function spawnForLane(track, lane) {
  const idx = track.data.startIndex ?? 0;
  const points = track.waypoints.points;
  const node = points[idx];
  const next = points[(idx + 1) % points.length];
  const tangent = new THREE.Vector3().subVectors(next, node).normalize();
  const lateral = Waypoints.lateral(tangent);
  const position = new THREE.Vector3().copy(node).addScaledVector(lateral, lane * LANE_SPACING);
  position.y += SPAWN_LIFT;
  return { position, quaternion: Waypoints.levelQuaternion(tangent) };
}

function startRace(trackData, p1Def, p2Def) {
  soundManager.stopAllEngines();
  clearSceneForNewRace();

  const { world, groundMaterial, carMaterial, loopMaterial } = createPhysicsWorld();
  const track = new Track(world, scene, groundMaterial, trackData, loopMaterial);
  scene.background = new THREE.Color(track.skyColor);
  scene.fog = new THREE.Fog(track.fogColor, 60, 220);
  soundManager.startAmbient(track.data.theme);

  const topDownCamera = new TopDownCamera(camera);

  function makeCar(def, lane, isHuman, playerLabel) {
    const spawn = spawnForLane(track, lane);
    const car = createCarFromDef(world, carMaterial, scene, def, spawn, playerLabel);
    // Elimination is exciting for both players watching the shared camera
    // regardless of who got knocked out, so this shake/sound fires for any
    // car's elimination, not gated to isHuman like the smaller per-impact
    // shake below.
    const damageSystem = new DamageSystem(car, scene, world, {
      onEliminate: () => {
        topDownCamera.addShake(0.8);
        soundManager.playExplosion();
      },
    });
    car.damageSystem = damageSystem;
    car.physics.chassisBody.userData = { car };
    // Shake the shared camera and play a crash sound on hard hits to either
    // human car — AI-only pileups elsewhere on track don't affect the
    // player-facing view/audio.
    const onImpact = isHuman
      ? (damage) => {
          topDownCamera.addShake(damage / 60);
          soundManager.playCrash(damage / 30);
        }
      : undefined;
    attachCollisionDamage(car.physics.chassisBody, damageSystem, onImpact);
    return car;
  }

  const starts = track.data.startPositions;
  // Compares by id, not reference: Car Select now hands startRace() a
  // shallow clone of the chosen def (trim color folded in), so the
  // original CAR_DEFS entries are never reference-equal to p1Def/p2Def.
  const aiDefs = CAR_DEFS.filter((d) => d.id !== p1Def.id && d.id !== p2Def.id);

  // Colors match the existing P1/P2 accent colors used elsewhere in the UI
  // (Car Select's picked-p1/picked-p2 border, HUD panel styling).
  const p1Car = makeCar(p1Def, starts[0].lane, true, { text: '1', color: '#2299ee' });
  const p2Car = makeCar(p2Def, starts[1].lane, true, { text: '2', color: '#ee3333' });
  soundManager.startEngine(p1Car);
  soundManager.startEngine(p2Car);
  // Camera shake/sound only for a human car's boost, matching the existing
  // isHuman-gated crash feedback — AI-only boosts elsewhere on track don't
  // affect the player-facing view/audio.
  track.onBoostHit = (car) => {
    if (car !== p1Car && car !== p2Car) return;
    topDownCamera.addShake(0.25);
    soundManager.playBoost();
  };
  const aiEntries = aiDefs.slice(0, FIELD_SIZE - 2).map((def, i) => {
    const start = starts[i + 2] ?? { lane: starts[1].lane - 2 - i };
    const aiCar = makeCar(def, start.lane);
    // AI targets slightly below its own topSpeed (still reachable on the
    // straights, never faster than a player in the same car) so opponents
    // pressure the player less relentlessly.
    const controller = new AIController(aiCar, track.waypoints, {
      baseSpeed: def.topSpeed * 0.88,
      skill: def.skill,
    });
    return { car: aiCar, controller };
  });

  const allCars = [p1Car, p2Car, ...aiEntries.map((e) => e.car)];

  const raceEntries = [
    { car: p1Car, name: 'Player 1' },
    { car: p2Car, name: 'Player 2' },
    ...aiEntries.map((e) => ({ car: e.car, name: e.car.def.name })),
  ];
  const raceManager = new RaceManager(raceEntries, track.waypoints);

  race = { world, track, p1Car, p2Car, aiEntries, allCars, raceEntries, raceManager, topDownCamera };
  if (import.meta.env.DEV) window.__race = race;

  hud.show();
  touchControls.show();
  gameState.set(States.RACING);
}

const FALL_RESPAWN_Y = -60;
const FALL_DAMAGE = 20;

function handleFallRecovery(c) {
  if (c.position.y >= FALL_RESPAWN_Y) return;
  const state = c.trackState;
  const quaternion = state ? Waypoints.levelQuaternion(state.tangent) : undefined;
  const position = state
    ? new CANNON.Vec3(state.point.x, state.point.y + SPAWN_LIFT, state.point.z)
    : new CANNON.Vec3(0, 3, 0);
  c.respawnAt(position, quaternion);
  if (c.damageSystem) c.damageSystem.applyDamage(FALL_DAMAGE);
}

// --- UI / state wiring ------------------------------------------------------
const gameState = new GameState();

const mainMenu = createMainMenu(uiRoot, {
  onStart: () => {
    soundManager.unlock(); // must happen from a user-gesture handler
    gameState.set(States.TRACK_SELECT);
  },
  onHowToPlay: () => gameState.set(States.HOW_TO_PLAY),
});
const howToPlay = createHowToPlay(uiRoot, {
  onBack: () => gameState.set(States.MAIN_MENU),
});
const trackSelect = createTrackSelect(uiRoot, TRACKS, {
  onSelect: (trackData) => {
    gameState.selection.trackData = trackData;
    gameState.set(States.CAR_SELECT);
  },
});
const carSelect = createCarSelect(uiRoot, CAR_DEFS, {
  onConfirm: (p1Def, p2Def) => {
    gameState.selection.p1Def = p1Def;
    gameState.selection.p2Def = p2Def;
    startRace(gameState.selection.trackData, p1Def, p2Def);
  },
});
function exitToMainMenu() {
  soundManager.stopAllEngines();
  soundManager.stopAmbient();
  clearSceneForNewRace();
  race = null;
  gameState.set(States.MAIN_MENU);
}

const hud = createHUD(uiRoot, { onExit: exitToMainMenu });
const touchControls = createTouchControls(uiRoot, P1_KEYS, P2_KEYS);
const resultsScreen = createResultsScreen(uiRoot, {
  onRaceAgain: () => {
    const { trackData, p1Def, p2Def } = gameState.selection;
    startRace(trackData, p1Def, p2Def);
  },
  onMainMenu: exitToMainMenu,
});

const screens = { mainMenu, howToPlay, trackSelect, carSelect, resultsScreen };
gameState.onChange((state) => {
  for (const s of Object.values(screens)) s.hide();
  if (state !== States.RACING) { hud.hide(); touchControls.hide(); }
  if (state === States.MAIN_MENU) mainMenu.show();
  else if (state === States.HOW_TO_PLAY) howToPlay.show();
  else if (state === States.TRACK_SELECT) trackSelect.show();
  else if (state === States.CAR_SELECT) carSelect.show();
});
mainMenu.show();

if (import.meta.env.DEV) window.__gameState = gameState;
if (import.meta.env.DEV) window.__hud = hud;
if (import.meta.env.DEV) window.__resultsScreen = resultsScreen;

// --- Main loop --------------------------------------------------------------
let lastTime = performance.now();
let accumulator = 0;

function tick(now) {
  const frameDt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  if (gameState.state === States.RACING && race) {
    accumulator += frameDt;
    const { world, track, p1Car, p2Car, aiEntries, allCars, raceEntries, raceManager, topDownCamera } = race;

    const getLeaderProgress = () => {
      const l1 = p1Car.updateTrackProgress(track.waypoints);
      const l2 = p2Car.updateTrackProgress(track.waypoints);
      return Math.max(l1, l2);
    };

    while (accumulator >= FIXED_STEP) {
      p1Car.applyInput(readInput(P1_KEYS));
      p2Car.applyInput(readInput(P2_KEYS));
      for (const entry of aiEntries) {
        entry.car.applyInput(entry.controller.update(getLeaderProgress));
      }
      world.step(FIXED_STEP);
      accumulator -= FIXED_STEP;
    }

    // Guarantees P1/P2 progress is fresh this frame even in the rare case
    // every AI car (the only other caller of getLeaderProgress) is eliminated.
    p1Car.updateTrackProgress(track.waypoints);
    p2Car.updateTrackProgress(track.waypoints);

    for (const c of allCars) {
      c.syncMeshes();
      c.damageSystem.update(frameDt);
    }
    track.update(frameDt);
    for (const c of allCars) handleFallRecovery(c);
    raceManager.update();
    hud.update(raceEntries, { totalLength: track.waypoints.totalLength, elapsed: track.elapsed });

    topDownCamera.update(p1Car.position, p2Car.position, frameDt);
    soundManager.updateEngine(p1Car, p1Car.physics.chassisBody.velocity.length(), p1Car.eliminated);
    soundManager.updateEngine(p2Car, p2Car.physics.chassisBody.velocity.length(), p2Car.eliminated);

    if (raceManager.finished) {
      soundManager.stopAllEngines();
      soundManager.stopAmbient();
      hud.hide();
      touchControls.hide();
      gameState.set(States.RESULTS);
      resultsScreen.show(raceManager.placements);
    }
  }

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
