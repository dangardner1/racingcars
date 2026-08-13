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
import { readInput } from './input/InputManager.js';
import { P1_KEYS, P2_KEYS } from './input/KeyBindings.js';
import { AIController } from './ai/AIController.js';
import { SideScrollCamera } from './camera/SideScrollCamera.js';
import { createMainMenu } from './ui/MainMenu.js';
import { createTrackSelect } from './ui/TrackSelect.js';
import { createCarSelect } from './ui/CarSelect.js';
import { createHUD } from './ui/HUD.js';
import { createResultsScreen } from './ui/ResultsScreen.js';
import { SoundManager } from './audio/SoundManager.js';

const canvas = document.getElementById('game-canvas');
const uiRoot = document.getElementById('ui-root');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(window.devicePixelRatio);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101018);
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
camera.position.set(0, 5, 20);

const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.2);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(5, 12, 8);
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

function clearSceneForNewRace() {
  for (const child of [...scene.children]) {
    if (child === hemi || child === sun) continue;
    scene.remove(child);
  }
}

function startRace(trackData, p1Def, p2Def) {
  soundManager.stopAllEngines();
  clearSceneForNewRace();

  const { world, groundMaterial, carMaterial, loopMaterial } = createPhysicsWorld();
  const track = new Track(world, scene, groundMaterial, trackData, loopMaterial);
  scene.background = new THREE.Color(track.skyColor);
  scene.fog = new THREE.Fog(track.fogColor, 40, 140);

  const sideScrollCamera = new SideScrollCamera(camera);

  function makeCar(def, x, isHuman) {
    const car = createCarFromDef(world, carMaterial, scene, def, x);
    const damageSystem = new DamageSystem(car, scene, world);
    car.damageSystem = damageSystem;
    car.physics.chassisBody.userData = { car };
    for (const wheel of car.physics.wheels) wheel.body.userData = { car };
    // Shake the shared camera and play a crash sound on hard hits to either
    // human car — AI-only pileups elsewhere on track don't affect the
    // player-facing view/audio.
    const onImpact = isHuman
      ? (damage) => {
          sideScrollCamera.addShake(damage / 60);
          soundManager.playCrash(damage / 30);
        }
      : undefined;
    attachCollisionDamage(car.physics.chassisBody, damageSystem, onImpact);
    return car;
  }

  const starts = track.data.startPositions;
  const aiDefs = CAR_DEFS.filter((d) => d !== p1Def && d !== p2Def);

  const p1Car = makeCar(p1Def, starts[0].x, true);
  const p2Car = makeCar(p2Def, starts[1].x, true);
  soundManager.startEngine(p1Car);
  soundManager.startEngine(p2Car);
  const aiEntries = aiDefs.slice(0, 9).map((def, i) => {
    const start = starts[i + 2] ?? { x: starts[1].x - 4 - i * 3 };
    const aiCar = makeCar(def, start.x);
    const controller = new AIController(aiCar, track.waypoints, {
      baseSpeed: def.topSpeed,
      skill: def.skill,
    });
    return { car: aiCar, controller };
  });

  const allCars = [p1Car, p2Car, ...aiEntries.map((e) => e.car)];
  for (const c of allCars) c.lastSafeX = c.position.x;

  const raceEntries = [
    { car: p1Car, name: 'Player 1' },
    { car: p2Car, name: 'Player 2' },
    ...aiEntries.map((e) => ({ car: e.car, name: e.car.def.name })),
  ];
  const raceManager = new RaceManager(raceEntries, track.waypoints, track.data.finishLine);

  race = { world, track, p1Car, p2Car, aiEntries, allCars, raceEntries, raceManager, sideScrollCamera };
  if (import.meta.env.DEV) window.__race = race;

  hud.show();
  gameState.set(States.RACING);
}

const FALL_RESPAWN_Y = -20;
const FALL_DAMAGE = 20;

function handleFallRecovery(c) {
  if (c.position.y > -1.5) {
    c.lastSafeX = c.position.x;
  } else if (c.position.y < FALL_RESPAWN_Y) {
    c.respawnAt(c.lastSafeX, 5);
    if (c.damageSystem) c.damageSystem.applyDamage(FALL_DAMAGE);
  }
}

// --- UI / state wiring ------------------------------------------------------
const gameState = new GameState();

const mainMenu = createMainMenu(uiRoot, {
  onStart: () => {
    soundManager.unlock(); // must happen from a user-gesture handler
    gameState.set(States.TRACK_SELECT);
  },
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
const hud = createHUD(uiRoot);
const resultsScreen = createResultsScreen(uiRoot, {
  onRaceAgain: () => {
    const { trackData, p1Def, p2Def } = gameState.selection;
    startRace(trackData, p1Def, p2Def);
  },
  onMainMenu: () => {
    soundManager.stopAllEngines();
    clearSceneForNewRace();
    race = null;
    gameState.set(States.MAIN_MENU);
  },
});

const screens = { mainMenu, trackSelect, carSelect, resultsScreen };
gameState.onChange((state) => {
  for (const s of Object.values(screens)) s.hide();
  if (state !== States.RACING) hud.hide();
  if (state === States.MAIN_MENU) mainMenu.show();
  else if (state === States.TRACK_SELECT) trackSelect.show();
  else if (state === States.CAR_SELECT) carSelect.show();
});
mainMenu.show();

if (import.meta.env.DEV) window.__gameState = gameState;

// --- Main loop --------------------------------------------------------------
let lastTime = performance.now();
let accumulator = 0;

function tick(now) {
  const frameDt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  if (gameState.state === States.RACING && race) {
    accumulator += frameDt;
    const { world, track, p1Car, p2Car, aiEntries, allCars, raceEntries, raceManager, sideScrollCamera } = race;

    const getLeaderProgress = () =>
      Math.max(
        track.waypoints.progressForX(p1Car.position.x),
        track.waypoints.progressForX(p2Car.position.x)
      );

    while (accumulator >= FIXED_STEP) {
      p1Car.applyInput(readInput(P1_KEYS));
      p2Car.applyInput(readInput(P2_KEYS));
      for (const entry of aiEntries) {
        entry.car.applyInput(entry.controller.update(getLeaderProgress));
      }
      world.step(FIXED_STEP);
      accumulator -= FIXED_STEP;
    }

    for (const c of allCars) {
      c.syncMeshes();
      c.damageSystem.update(frameDt);
    }
    track.update(frameDt);
    for (const c of allCars) handleFallRecovery(c);
    raceManager.update();
    hud.update(raceEntries, track.waypoints);

    sideScrollCamera.update(p1Car.position, p2Car.position, frameDt);
    soundManager.updateEngine(p1Car, p1Car.physics.chassisBody.velocity.length(), p1Car.eliminated);
    soundManager.updateEngine(p2Car, p2Car.physics.chassisBody.velocity.length(), p2Car.eliminated);

    if (raceManager.finished) {
      soundManager.stopAllEngines();
      hud.hide();
      gameState.set(States.RESULTS);
      resultsScreen.show(raceManager.placements);
    }
  }

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
