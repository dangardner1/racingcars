# Battle Racer

A 2.5D side-scrolling arcade battle racer built with [Three.js](https://threejs.org/) and [cannon-es](https://github.com/pmndrs/cannon-es). Two local players race 9 AI opponents across crazy themed tracks full of ramps, loops, spike pits, crumbling bridges, and moving platforms — crash into each other, take damage, and be the last car standing (or just cross the finish line first).

## Features

- **2-player local multiplayer** on one keyboard, plus 9 AI opponents (11 cars per race)
- **10 themed tracks** — Desert Canyon, Volcano, Ice Glacier, Neon City, Junkyard, Jungle Ruins, Construction Site, Space Station, Storm Coast, Haunted Circuit
- **Destructible cars** — a 4-stage damage system with visual wear, part detachment, and elimination
- **Environmental hazards** — ramps, loops, spike pits, crumbling bridges, moving platforms, boost pads
- **Win either way** — survive as the last car standing, or cross the finish line first
- **Procedural sound** — engine and crash audio synthesized live, no external audio files
- No external art or audio assets — every car and track is built from primitive geometry in code

## Setup

Requires [Node.js](https://nodejs.org/) 18+.

```bash
npm install
npm run dev
```

Then open the URL Vite prints (defaults to `http://localhost:5173`).

## Controls

| Action | Player 1 | Player 2 |
|---|---|---|
| Throttle / Brake | `W` / `S` | `Arrow Up` / `Arrow Down` |
| Lean | `A` / `D` | `Arrow Left` / `Arrow Right` |
| Handbrake | `Space` | `Right Shift` |

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the local dev server with hot reload |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Preview the production build locally |

## Project structure

```
src/
  main.js          # entry point, game loop, state wiring
  game/            # Car, Track, DamageSystem, RaceManager, GameState
  physics/         # cannon-es world setup and car physics
  ai/              # AI driving logic, waypoints, rubber-banding
  input/           # keyboard bindings for both players
  camera/          # shared dynamic side-scroll camera
  audio/           # procedural engine/crash sound
  cars/            # the 11 car definitions
  tracks/          # the 10 track data files (JSON)
  ui/              # menu, select, HUD, and results screens
scripts/
  generate-tracks.mjs   # one-off generator used to author tracks 02–10
```

Tracks are data-driven JSON files interpreted by `src/game/Track.js`, so new hazards or tracks can be added without touching the renderer or physics code.
