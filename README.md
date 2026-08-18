# Battle Racer

A top-down/three-quarter-view arcade battle racer built with [Three.js](https://threejs.org/) and [cannon-es](https://github.com/pmndrs/cannon-es). Two local players race 3 AI opponents around a genuine figure-eight circuit — the track crosses over itself at a real highway-style interchange, threading through a tunnel on one pass and over an elevated bridge on the other — full of hills, ramps, spike pits, crumbling bridges, and loops. Crash into each other, take damage, and be the last car standing (or cross the finish line first after a full lap).

## Features

- **2-player local multiplayer** on one keyboard, plus 3 AI opponents (5 cars per race)
- **Real 4-wheel steering** (`CANNON.RaycastVehicle`) with suspension that follows hills, ramps, and bridge/tunnel decks
- **10 themed figure-eight tracks** — Desert Canyon, Volcano, Ice Glacier, Neon City, Junkyard, Jungle Ruins, Construction Site, Space Station, Storm Coast, Haunted Circuit — each with its own tunnel-under/bridge-over crossing
- **Destructible cars** — a 4-stage damage system with visual wear, part detachment, and elimination
- **Environmental hazards** — hills, tunnels, bridges, loops, spike pits, crumbling bridges, boost pads
- **Win either way** — survive as the last car standing, or complete the lap first
- **Elevated top-down camera** shared by both players, zooming out as they spread apart
- **Procedural visuals** — tiled asphalt with lane markings, guardrails, terrain, and roadside props all generated in code; procedural sound too — no external art or audio assets

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
| Throttle / Brake (reverse) | `W` / `S` | `Arrow Up` / `Arrow Down` |
| Steer | `A` / `D` | `Arrow Left` / `Arrow Right` |
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
  game/            # Car, Track, DamageSystem, RaceManager, GameState, RoadTexture
  physics/         # cannon-es world setup and 4-wheel RaycastVehicle car physics
  ai/              # AI pursuit-steering, path/Waypoints, rubber-banding
  input/           # keyboard bindings for both players
  camera/          # shared top-down/three-quarter camera
  audio/           # procedural engine/crash sound
  cars/            # the 11 car definitions (roster; a race seats 5)
  tracks/          # the 10 figure-eight track data files (JSON)
  ui/              # menu, select, HUD, and results screens
scripts/
  generate-tracks.mjs   # generator used to author all 10 figure-eight tracks
```

Tracks are data-driven JSON files interpreted by `src/game/Track.js`: a track is an ordered, closed loop of centerline nodes (`path`, each with `x/y/z/width/type`). Elevation differences between nodes are hills for free; `type` per node picks `flat`/`gap`/`bridge`/`tunnel`/`crumblingBridge`. Features (loops) and hazards (spike pits, boost pads) are positioned by node index. New hazards or tracks can be added without touching the renderer or physics code.
