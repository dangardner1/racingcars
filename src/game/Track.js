import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { Waypoints } from '../ai/Waypoints.js';
import { createAsphaltTexture, applyRoadUV } from './RoadTexture.js';

const HAZARD_HIT_COOLDOWN = 1; // seconds, prevents repeated damage from one overlap
const WORLD_UP = new THREE.Vector3(0, 1, 0);

/** Orientation/length of the straight segment from `a` to `b` (both THREE.Vector3). */
function segmentBasis(a, b) {
  const forward = new THREE.Vector3().subVectors(b, a);
  const length = forward.length();
  forward.normalize();
  let right = new THREE.Vector3().crossVectors(forward, WORLD_UP);
  if (right.lengthSq() < 1e-6) right.set(1, 0, 0); // near-vertical segment fallback
  right.normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();
  const center = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(forward, up, right)
  );
  return { forward, up, right, center, length, quaternion };
}

function toCannonVec(v) {
  return new CANNON.Vec3(v.x, v.y, v.z);
}
function toCannonQuat(q) {
  return new CANNON.Quaternion(q.x, q.y, q.z, q.w);
}

/**
 * Parses a data-driven track JSON into Three.js geometry + cannon-es bodies.
 * `path` is an ordered, closed loop of centerline nodes {x,y,z,width,type}
 * forming the drivable line — elevation differences between nodes are
 * hills for free, and `type` on each node describes the segment starting
 * there (flat / gap / bridge / tunnel / crumblingBridge). A figure-eight's
 * self-crossing is just two different arc-length spans of this same
 * ordered path sharing an XZ location at different elevations (tunnel
 * underneath, bridge above) — Waypoints.locate()'s windowed search is what
 * keeps those two passes from being confused with each other. Features and
 * hazards are additive and positioned by node index (`atIndex`) rather
 * than a bare X, with orientation derived from the local path tangent.
 */
export class Track {
  constructor(world, scene, groundMaterial, data) {
    this.world = world;
    this.scene = scene;
    this.groundMaterial = groundMaterial;
    this.data = data;
    this.crumblingBridges = [];
    this.lastHazardHit = new WeakMap();
    // Shapes belonging to guardrails/tunnel walls, tagged so the collision
    // listener added at the end of _buildGround() can tell "hit a wall"
    // apart from "hit the road surface" even though both live on the same
    // compound groundBody.
    this.railShapes = new Set();
    this.elapsed = 0;
    this.boostPads = [];
    this.onBoostHit = null; // set by main.js to hook camera shake/sound on a human car's boost

    this.groundColor = new THREE.Color(data.groundColor ?? '#3a3a3a');
    this.skyColor = new THREE.Color(data.skyColor ?? '#87ceeb');
    this.fogColor = new THREE.Color(data.fogColor ?? data.skyColor ?? '#87ceeb');

    this.waypoints = new Waypoints(data.path);

    this._buildTerrainSkirt();
    this._buildGround();
    this._buildHazards();
    this._buildSafetyFloor();
    this._buildDirectionArrows();
    this._buildRoadsideProps();
    this._buildWeather();
    this._buildLandmark();
  }

  /** Shared XZ/Y bounding box of the whole path, used by anything that needs
   * to size/place itself relative to the track's overall footprint. */
  _trackBounds() {
    const pts = this.waypoints.points;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    return { minX, maxX, minY, maxY, minZ, maxZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 };
  }

  _pathNode(i) {
    const n = this.waypoints.points.length;
    return this.waypoints.points[((i % n) + n) % n];
  }

  /** Basis/length of the span from node `atIndex` to node `atIndex + spanNodes`. */
  _hazardFrame(atIndex, spanNodes = 1) {
    return segmentBasis(this._pathNode(atIndex), this._pathNode(atIndex + spanNodes));
  }

  /**
   * A large low ground plane beneath/around the whole track footprint so
   * driving off the side of the road lands on rough open ground instead of
   * falling into the void. Sits well below the track's lowest point so it
   * doesn't undermine intentional gap/pit hazards along the path.
   */
  _buildTerrainSkirt() {
    const pts = this.waypoints.points;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const margin = 70;
    const halfX = (maxX - minX) / 2 + margin;
    const halfZ = (maxZ - minZ) / 2 + margin;
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const topY = minY - 12;

    const body = new CANNON.Body({
      type: CANNON.Body.STATIC,
      shape: new CANNON.Box(new CANNON.Vec3(halfX, 1, halfZ)),
      material: this.groundMaterial,
      position: new CANNON.Vec3(cx, topY - 1, cz),
    });
    this.world.addBody(body);

    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(halfX * 2, 2, halfZ * 2),
      new THREE.MeshStandardMaterial({ color: this.groundColor.clone().offsetHSL(0, -0.15, -0.12) })
    );
    mesh.position.set(cx, topY, cz);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
  }

  /**
   * A last-resort catch-all floor far below the track. Not meant to be
   * reachable in normal play — it exists so a physics tunneling glitch or a
   * missed jump into open space never turns into an infinite fall; falling
   * this far still triggers the same respawn path main.js uses for pits.
   */
  _buildSafetyFloor() {
    const pts = this.waypoints.points;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const margin = 50;
    const halfX = (maxX - minX) / 2 + margin;
    const halfZ = (maxZ - minZ) / 2 + margin;
    const body = new CANNON.Body({
      type: CANNON.Body.STATIC,
      shape: new CANNON.Box(new CANNON.Vec3(halfX, 5, halfZ)),
      position: new CANNON.Vec3((minX + maxX) / 2, minY - 80, (minZ + maxZ) / 2),
    });
    this.world.addBody(body);
  }

  /**
   * All continuous drivable surfaces (flat/hill road, bridge decks+rails,
   * tunnel roads+roofs+walls) are shapes on ONE static compound body rather
   * than one Body per segment. With independent bodies, a fast car
   * spanning two differently-angled segments (inevitable on a curved path
   * — the wheelbase is comparable to a single segment's length) got
   * contradictory contact resolution at the seam and could catch, bounce,
   * or fall through — the same "tiled terrain seam" failure a naive
   * per-segment body layout is prone to.
   */
  _buildGround() {
    this.groundBody = new CANNON.Body({ type: CANNON.Body.STATIC, material: this.groundMaterial });

    const nodes = this.data.path;
    const n = nodes.length;
    for (let i = 0; i < n; i++) {
      const a = this.waypoints.points[i];
      const b = this.waypoints.points[(i + 1) % n];
      const type = nodes[i].type ?? 'flat';
      const width = nodes[i].width ?? 10;
      if (type === 'gap') continue;
      else if (type === 'flat') this._buildFlat(a, b, width);
      else if (type === 'bridge') this._buildBridge(a, b, width, nodes[i]);
      else if (type === 'tunnel') this._buildTunnel(a, b, width, nodes[i]);
      else if (type === 'crumblingBridge') this._buildCrumblingBridge(a, b, width, nodes[i]);
    }

    this.world.addBody(this.groundBody);

    // One listener for the whole compound body: distinguishes "hit a rail/
    // wall" from "hit the drivable surface" by checking which of the two
    // shapes in contact is tagged in railShapes, then hands CarPhysics the
    // car's current track tangent so it can nudge the car's yaw back
    // toward facing along the track instead of leaving it spun at whatever
    // angle the bounce happened to produce.
    this.groundBody.addEventListener('collide', (event) => {
      const car = event.body.userData?.car;
      if (!car || !car.trackState) return;
      const contact = event.contact;
      const myShape = contact.bi === this.groundBody ? contact.si : contact.sj;
      if (!this.railShapes.has(myShape)) return;
      car.physics.chassisBody.userData.wallBounceTangent = car.trackState.tangent.clone();
    });
  }

  /**
   * Thin vertical walls along both edges of a road span — the "guard
   * rails" that keep a car from driving/bouncing off the side of the
   * track. Shapes go on the same compound groundBody as everything else
   * (not their own bodies) — independent bodies at a seam produce
   * contradictory contact resolution a fast car can catch or wedge
   * against, the same "tiled terrain seam" issue _buildGround() avoids
   * for the road surface itself. Registered
   * in railShapes so the collide listener in _buildGround() can tell a
   * wall hit apart from a road-surface hit.
   */
  _addGuardrail(center, right, up, quaternion, length, halfWidth, railHeight = 1.8) {
    const railThickness = 0.2;
    for (const side of [-1, 1]) {
      const railCenter = new THREE.Vector3()
        .copy(center)
        .addScaledVector(right, side * halfWidth)
        .addScaledVector(up, railHeight / 2);
      const shape = new CANNON.Box(new CANNON.Vec3(length / 2, railHeight / 2, railThickness));
      this.groundBody.addShape(shape, toCannonVec(railCenter), toCannonQuat(quaternion));
      this.railShapes.add(shape);

      const railMesh = new THREE.Mesh(
        new THREE.BoxGeometry(length, railHeight, railThickness * 2),
        new THREE.MeshStandardMaterial({ color: 0x9a8a70 })
      );
      railMesh.position.copy(railCenter);
      railMesh.quaternion.copy(quaternion);
      railMesh.castShadow = true;
      this.scene.add(railMesh);
    }
  }

  _buildFlat(a, b, width, { skipGuardrail = false } = {}) {
    const { center, quaternion, length, up, right } = segmentBasis(a, b);
    // Half-height is generously thick (not a thin slab) so a fast-moving
    // car can't tunnel through it in a single physics step.
    const halfHeight = 2;
    const halfWidth = width / 2;
    const bodyCenter = new THREE.Vector3().copy(center).addScaledVector(up, -halfHeight);

    this.groundBody.addShape(
      new CANNON.Box(new CANNON.Vec3(length / 2, halfHeight, halfWidth)),
      toCannonVec(bodyCenter),
      toCannonQuat(quaternion)
    );

    const geometry = new THREE.BoxGeometry(length, halfHeight * 2, width);
    applyRoadUV(geometry, length, width);
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: this.groundColor,
        map: createAsphaltTexture(),
        roughness: 0.95,
      })
    );
    mesh.position.copy(bodyCenter);
    mesh.quaternion.copy(quaternion);
    mesh.receiveShadow = true;
    this.scene.add(mesh);

    // Tunnels delegate their road slab to this method but build their own,
    // taller side walls (which also get tagged into railShapes) — skip the
    // road-height guardrail there to avoid two overlapping barriers at the
    // same edge.
    if (!skipGuardrail) this._addGuardrail(center, right, up, quaternion, length, halfWidth);
  }

  /** Elevated deck with side guardrails + support pillars — crosses OVER a gap or another path span. */
  _buildBridge(a, b, width, node) {
    const { center, quaternion, length, up, right } = segmentBasis(a, b);
    const halfHeight = 0.35;
    const halfWidth = width / 2;
    const bodyCenter = new THREE.Vector3().copy(center).addScaledVector(up, -halfHeight);

    this.groundBody.addShape(
      new CANNON.Box(new CANNON.Vec3(length / 2, halfHeight, halfWidth)),
      toCannonVec(bodyCenter),
      toCannonQuat(quaternion)
    );

    const deckGeometry = new THREE.BoxGeometry(length, halfHeight * 2, width);
    applyRoadUV(deckGeometry, length, width);
    const deckMesh = new THREE.Mesh(
      deckGeometry,
      new THREE.MeshStandardMaterial({ color: 0x8a7a68, map: createAsphaltTexture(), roughness: 0.9 })
    );
    deckMesh.position.copy(bodyCenter);
    deckMesh.quaternion.copy(quaternion);
    deckMesh.receiveShadow = true;
    this.scene.add(deckMesh);

    this._addGuardrail(center, right, up, quaternion, length, halfWidth, 2.0);

    // Purely visual support pillars down to the ground, only when the deck is actually elevated.
    if (center.y > 1.5) {
      const pillarMat = new THREE.MeshStandardMaterial({ color: 0x554433 });
      for (const side of [-0.6, 0.6]) {
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, center.y, 8), pillarMat);
        pillar.position.copy(center).addScaledVector(right, side * halfWidth * 0.7);
        pillar.position.y = center.y / 2;
        pillar.castShadow = true;
        this.scene.add(pillar);
      }
    }

    void node;
  }

  /** Road slab plus an arched roof + side walls above it — ducks UNDER a bridge at the crossing. */
  _buildTunnel(a, b, width, node) {
    this._buildFlat(a, b, width, { skipGuardrail: true });
    const { center, quaternion, length, up, right } = segmentBasis(a, b);
    const halfWidth = width / 2;
    const clearance = 3.4; // vehicle clearance height inside the tunnel
    const wallThickness = 0.4;
    const tunnelMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2e });

    const roofCenter = new THREE.Vector3().copy(center).addScaledVector(up, clearance);
    this.groundBody.addShape(
      new CANNON.Box(new CANNON.Vec3(length / 2, wallThickness / 2, halfWidth + wallThickness)),
      toCannonVec(roofCenter),
      toCannonQuat(quaternion)
    );

    const roofMesh = new THREE.Mesh(
      new THREE.BoxGeometry(length, wallThickness, width + wallThickness * 2),
      tunnelMat
    );
    roofMesh.position.copy(roofCenter);
    roofMesh.quaternion.copy(quaternion);
    roofMesh.castShadow = true;
    this.scene.add(roofMesh);

    for (const side of [-1, 1]) {
      const wallCenter = new THREE.Vector3()
        .copy(center)
        .addScaledVector(right, side * (halfWidth + wallThickness / 2))
        .addScaledVector(up, clearance / 2);
      const wallShape = new CANNON.Box(new CANNON.Vec3(length / 2, clearance / 2, wallThickness / 2));
      this.groundBody.addShape(wallShape, toCannonVec(wallCenter), toCannonQuat(quaternion));
      this.railShapes.add(wallShape);

      const wallMesh = new THREE.Mesh(new THREE.BoxGeometry(length, clearance, wallThickness), tunnelMat);
      wallMesh.position.copy(wallCenter);
      wallMesh.quaternion.copy(quaternion);
      this.scene.add(wallMesh);
    }

    // Dim interior light so the tunnel isn't pitch black under fog/shadow.
    const stripLight = new THREE.PointLight(0xffe8b0, 1.1, Math.max(length, width) * 1.6);
    stripLight.position.copy(center).addScaledVector(up, clearance * 0.7);
    this.scene.add(stripLight);

    void node;
  }

  _buildCrumblingBridge(a, b, width, node) {
    const { center, quaternion, length, up } = segmentBasis(a, b);
    const halfHeight = 0.3;
    const halfWidth = width / 2;
    const bodyCenter = new THREE.Vector3().copy(center).addScaledVector(up, -halfHeight);

    const body = new CANNON.Body({
      type: CANNON.Body.STATIC,
      shape: new CANNON.Box(new CANNON.Vec3(length / 2, halfHeight, halfWidth)),
      material: this.groundMaterial,
      position: toCannonVec(bodyCenter),
      quaternion: toCannonQuat(quaternion),
    });
    this.world.addBody(body);

    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(length, halfHeight * 2, width),
      new THREE.MeshStandardMaterial({ color: 0x7a5230 })
    );
    mesh.position.copy(bodyCenter);
    mesh.quaternion.copy(quaternion);
    mesh.receiveShadow = true;
    this.scene.add(mesh);

    const bridge = { body, mesh, hits: 0, collapseAfterHits: node.collapseAfterHits ?? 3, collapsed: false };
    body.addEventListener('collide', (event) => {
      if (bridge.collapsed) return;
      if (!event.body.userData?.car) return;
      bridge.hits += 1;
      if (bridge.hits >= bridge.collapseAfterHits) this._collapseBridge(bridge);
    });
    this.crumblingBridges.push(bridge);
  }

  _collapseBridge(bridge) {
    bridge.collapsed = true;
    bridge.body.type = CANNON.Body.DYNAMIC;
    bridge.body.mass = 30;
    bridge.body.updateMassProperties();
    bridge.body.wakeUp();
  }

  _buildHazards() {
    for (const hazard of this.data.hazards ?? []) {
      if (hazard.type === 'spikePit') this._buildSpikePit(hazard);
      else if (hazard.type === 'boostPad') this._buildBoostPad(hazard);
    }
  }

  /**
   * A damage strip flush with the road surface — spikes protrude up out of
   * solid ground rather than sitting in a hole, so hitting it costs health
   * but never drops a car into open space. The road under this hazard is
   * built normally by _buildGround() (the path node is 'flat', not 'gap');
   * this only adds the non-collision damage trigger and spike meshes on
   * top of it.
   */
  _buildSpikePit(hazard) {
    const span = hazard.spanNodes ?? 1;
    const width = hazard.width ?? this.data.path[hazard.atIndex]?.width ?? 10;
    const { center, quaternion, length, up } = this._hazardFrame(hazard.atIndex, span);
    const triggerCenter = new THREE.Vector3().copy(center).addScaledVector(up, 0.4);

    const body = new CANNON.Body({
      type: CANNON.Body.STATIC,
      collisionResponse: false,
      shape: new CANNON.Box(new CANNON.Vec3(length / 2, 0.4, width / 2)),
      position: toCannonVec(triggerCenter),
      quaternion: toCannonQuat(quaternion),
    });
    this.world.addBody(body);

    const spikeGeo = new THREE.ConeGeometry(0.3, 0.8, 4);
    const spikeMat = new THREE.MeshStandardMaterial({ color: 0x888888 });
    const spikeCount = Math.max(2, Math.floor(length / 1.2));
    const a = this._pathNode(hazard.atIndex);
    const b = this._pathNode(hazard.atIndex + span);
    for (let i = 0; i < spikeCount; i++) {
      const t = (i + 0.5) / spikeCount;
      const mesh = new THREE.Mesh(spikeGeo, spikeMat);
      mesh.position.copy(a).lerp(b, t).addScaledVector(up, 0.4);
      mesh.quaternion.copy(quaternion);
      this.scene.add(mesh);
    }

    body.addEventListener('collide', (event) => {
      const car = event.body.userData?.car;
      if (!car || !car.damageSystem) return;
      const last = this.lastHazardHit.get(car) ?? -Infinity;
      if (this.elapsed - last < HAZARD_HIT_COOLDOWN) return;
      this.lastHazardHit.set(car, this.elapsed);
      car.damageSystem.applyDamage(hazard.damage ?? 25);
    });
  }

  /**
   * Sets a car's forward speed to a fixed target on contact, regardless of
   * its own topSpeed stat — a speed burst independent of what a car's own
   * drivetrain can reach.
   */
  _buildBoostPad(hazard) {
    const span = hazard.spanNodes ?? 1;
    const width = hazard.width ?? this.data.path[hazard.atIndex]?.width ?? 10;
    const { center, quaternion, length, up, forward } = this._hazardFrame(hazard.atIndex, span);
    const padCenter = new THREE.Vector3().copy(center).addScaledVector(up, 0.3);

    const body = new CANNON.Body({
      type: CANNON.Body.STATIC,
      collisionResponse: false,
      shape: new CANNON.Box(new CANNON.Vec3(length / 2, 0.6, width / 2)),
      position: toCannonVec(padCenter),
      quaternion: toCannonQuat(quaternion),
    });
    this.world.addBody(body);

    const mat = new THREE.MeshStandardMaterial({ color: 0x33ffcc, emissive: 0x116644, emissiveIntensity: 1 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(length, 0.15, width), mat);
    mesh.position.copy(center).addScaledVector(up, 0.1);
    mesh.quaternion.copy(quaternion);
    this.scene.add(mesh);

    const pad = { mat, flashTimer: 0 };
    this.boostPads.push(pad);

    const boostSpeed = hazard.speed ?? 20;
    const tangentVec = toCannonVec(forward);
    const upVec = toCannonVec(up);
    body.addEventListener('collide', (event) => {
      const car = event.body.userData?.car;
      if (!car) return;
      const last = this.lastHazardHit.get(car) ?? -Infinity;
      if (this.elapsed - last < HAZARD_HIT_COOLDOWN) return;
      this.lastHazardHit.set(car, this.elapsed);
      const cb = car.physics.chassisBody;
      const forwardSpeed = cb.velocity.dot(tangentVec);
      if (forwardSpeed < boostSpeed) {
        const verticalSpeed = cb.velocity.dot(upVec);
        cb.velocity.copy(tangentVec.scale(boostSpeed).vadd(upVec.scale(verticalSpeed)));
      }
      pad.flashTimer = 0.4;
      this.onBoostHit?.(car);
    });
  }

  /**
   * Ground-level chevrons pointing along the direction of travel. Purely
   * visual (no physics body), driven entirely by `path` already in the
   * track JSON, so every track gets them automatically.
   */
  _buildDirectionArrows() {
    const spacing = 18;
    const geo = new THREE.ConeGeometry(0.5, 1.2, 3);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffee88, emissive: 0x554400 });
    const nodes = this.data.path;
    const n = nodes.length;
    const upAxis = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < n; i++) {
      const type = nodes[i].type ?? 'flat';
      if (type === 'gap') continue;
      const a = this.waypoints.points[i];
      const b = this.waypoints.points[(i + 1) % n];
      const { forward, up, length } = segmentBasis(a, b);
      for (let d = spacing / 2; d < length; d += spacing) {
        const t = d / length;
        const pos = new THREE.Vector3().copy(a).lerp(b, t).addScaledVector(up, 0.6);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(pos);
        mesh.quaternion.setFromUnitVectors(upAxis, forward);
        this.scene.add(mesh);
      }
    }
  }

  /**
   * Simple scattered primitive-geometry props (rocks + spires) along flat
   * roadside edges, purely visual, for a less empty world — no external
   * assets, colors derived from the track's own palette so they read as
   * belonging to the theme rather than generic clutter.
   */
  _buildRoadsideProps() {
    const spacing = 24;
    const rockColor = this.groundColor.clone().offsetHSL(0, -0.1, -0.2);
    const spireColor = this.groundColor.clone().offsetHSL(0.02, 0.05, 0.12);
    const rockMat = new THREE.MeshStandardMaterial({ color: rockColor, roughness: 1 });
    const spireMat = new THREE.MeshStandardMaterial({ color: spireColor, roughness: 0.85 });
    const nodes = this.data.path;
    const n = nodes.length;
    let side = 1;

    for (let i = 0; i < n; i++) {
      const type = nodes[i].type ?? 'flat';
      if (type !== 'flat') continue;
      const width = nodes[i].width ?? 10;
      const a = this.waypoints.points[i];
      const b = this.waypoints.points[(i + 1) % n];
      const { forward, up, right, length } = segmentBasis(a, b);

      for (let d = spacing / 2; d < length; d += spacing) {
        side *= -1;
        const t = d / length;
        const offset = width / 2 + 2.5 + Math.random() * 3;
        const base = new THREE.Vector3().copy(a).lerp(b, t).addScaledVector(right, side * offset);

        if (Math.random() < 0.5) {
          const s = 0.5 + Math.random() * 0.7;
          const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), rockMat);
          rock.position.copy(base).addScaledVector(up, s * 0.4);
          rock.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
          rock.castShadow = true;
          this.scene.add(rock);
        } else {
          const h = 2.2 + Math.random() * 2.2;
          const spire = new THREE.Mesh(new THREE.ConeGeometry(0.55, h, 6), spireMat);
          spire.position.copy(base).addScaledVector(up, h / 2);
          spire.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
          spire.castShadow = true;
          this.scene.add(spire);
        }
      }

      void forward;
    }
  }

  /**
   * Purely cosmetic falling/drifting particles sized to the track's own
   * footprint, kind chosen from the track's theme. No physics — a car
   * drives through them with no interaction at all.
   */
  _buildWeather() {
    const KIND_BY_THEME = {
      desert_canyon: { color: 0xd8bd8a, count: 260, fall: 0.6, drift: 1.2, size: 0.12 },
      volcano: { color: 0x3a3a3a, count: 320, fall: 1.4, drift: 0.6, size: 0.14 },
      ice_glacier: { color: 0xffffff, count: 400, fall: 1.6, drift: 0.8, size: 0.14 },
      neon_city: { color: 0x66ffee, count: 350, fall: 9, drift: 0.2, size: 0.06, streak: true },
      junkyard: { color: 0xa89868, count: 200, fall: 0.5, drift: 1.4, size: 0.12 },
      jungle_ruins: { color: 0xbfe6a0, count: 220, fall: 0.7, drift: 0.9, size: 0.1 },
      construction_site: { color: 0xd8c890, count: 220, fall: 0.6, drift: 1.3, size: 0.12 },
      space_station: { color: 0xffffff, count: 300, fall: 0.15, drift: 0.1, size: 0.08 },
      storm_coast: { color: 0xcfe8ff, count: 420, fall: 12, drift: 0.4, size: 0.05, streak: true },
      haunted_circuit: { color: 0x8a8a9a, count: 260, fall: 0.35, drift: 0.7, size: 0.16 },
    };
    const cfg = KIND_BY_THEME[this.data.theme] ?? { color: 0xcccccc, count: 200, fall: 1, drift: 0.5, size: 0.1 };
    const b = this._trackBounds();
    const margin = 30;
    const halfX = (b.maxX - b.minX) / 2 + margin;
    const halfZ = (b.maxZ - b.minZ) / 2 + margin;
    const topY = b.maxY + 40;
    const bottomY = b.minY - 2;

    const count = cfg.count;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = b.cx + (Math.random() * 2 - 1) * halfX;
      positions[i * 3 + 1] = bottomY + Math.random() * (topY - bottomY);
      positions[i * 3 + 2] = b.cz + (Math.random() * 2 - 1) * halfZ;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: cfg.color,
      size: cfg.streak ? cfg.size * 3 : cfg.size,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
    });
    const points = new THREE.Points(geometry, material);
    this.scene.add(points);

    this.weather = { points, positions, cfg, topY, bottomY, halfX, halfZ, cx: b.cx, cz: b.cz };
  }

  /**
   * One large, unique, non-collidable set-piece per theme, placed off to
   * the side of the track's footprint purely for visual identity — no
   * physics body, so it can never become a new place to get stuck.
   */
  _buildLandmark() {
    const b = this._trackBounds();
    const offsetX = (b.maxX - b.minX) / 2 + 45;
    const pos = new THREE.Vector3(b.cx + offsetX, 0, b.cz);
    const group = new THREE.Group();
    group.position.copy(pos);

    const theme = this.data.theme;
    if (theme === 'desert_canyon') {
      // Rock arch.
      const mat = new THREE.MeshStandardMaterial({ color: 0x9a6a3a, roughness: 1 });
      for (const side of [-1, 1]) {
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(2, 2.6, 18, 8), mat);
        pillar.position.set(side * 8, 9, 0);
        group.add(pillar);
      }
      const arch = new THREE.Mesh(new THREE.TorusGeometry(8, 2.2, 8, 16, Math.PI), mat);
      arch.position.set(0, 18, 0);
      group.add(arch);
    } else if (theme === 'volcano') {
      const mat = new THREE.MeshStandardMaterial({ color: 0x3a2018, roughness: 1 });
      const cone = new THREE.Mesh(new THREE.ConeGeometry(22, 40, 10), mat);
      cone.position.y = 20;
      group.add(cone);
      const glow = new THREE.PointLight(0xff5522, 3, 60);
      glow.position.set(0, 40, 0);
      group.add(glow);
    } else if (theme === 'ice_glacier') {
      const mat = new THREE.MeshStandardMaterial({ color: 0xbfe8f5, roughness: 0.2, transparent: true, opacity: 0.85 });
      for (let i = 0; i < 5; i++) {
        const h = 12 + Math.random() * 16;
        const spire = new THREE.Mesh(new THREE.ConeGeometry(2.5 + Math.random() * 2, h, 5), mat);
        spire.position.set((Math.random() - 0.5) * 20, h / 2, (Math.random() - 0.5) * 20);
        group.add(spire);
      }
    } else if (theme === 'neon_city') {
      const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1a1a28 });
      const tower = new THREE.Mesh(new THREE.BoxGeometry(8, 55, 8), bodyMat);
      tower.position.y = 27.5;
      group.add(tower);
      const glowMat = new THREE.MeshStandardMaterial({ color: 0xff33dd, emissive: 0xff22cc, emissiveIntensity: 2 });
      for (let i = 0; i < 6; i++) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(4.2, 0.25, 8, 16), glowMat);
        ring.position.y = 6 + i * 8;
        ring.rotation.x = Math.PI / 2;
        group.add(ring);
      }
    } else if (theme === 'junkyard') {
      const mat = new THREE.MeshStandardMaterial({ color: 0x6a6a6a, metalness: 0.6, roughness: 0.7 });
      for (let i = 0; i < 5; i++) {
        const box = new THREE.Mesh(new THREE.BoxGeometry(3.5, 2.4, 3.5), mat);
        box.position.set((Math.random() - 0.5) * 4, 1.2 + i * 2.4, (Math.random() - 0.5) * 4);
        box.rotation.y = Math.random() * Math.PI;
        group.add(box);
      }
    } else if (theme === 'jungle_ruins') {
      const mat = new THREE.MeshStandardMaterial({ color: 0x8a7a5a, roughness: 1 });
      const body = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.5, 20, 8), mat);
      body.position.y = 10;
      group.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(4, 10, 8), mat);
      head.position.y = 22;
      group.add(head);
    } else if (theme === 'construction_site') {
      const mat = new THREE.MeshStandardMaterial({ color: 0xd8b030 });
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 40, 8), mat);
      mast.position.y = 20;
      group.add(mast);
      const jib = new THREE.Mesh(new THREE.BoxGeometry(30, 1.2, 1.2), mat);
      jib.position.set(10, 39, 0);
      group.add(jib);
      const counterJib = new THREE.Mesh(new THREE.BoxGeometry(8, 1.2, 1.2), mat);
      counterJib.position.set(-6, 39, 0);
      group.add(counterJib);
    } else if (theme === 'space_station') {
      const mat = new THREE.MeshStandardMaterial({ color: 0xaab0c0, metalness: 0.8, roughness: 0.3 });
      const dish = new THREE.Mesh(new THREE.SphereGeometry(10, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat);
      dish.position.y = 20;
      dish.rotation.x = Math.PI * 0.15;
      group.add(dish);
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 20, 6), mat);
      strut.position.y = 10;
      group.add(strut);
    } else if (theme === 'storm_coast') {
      const mat = new THREE.MeshStandardMaterial({ color: 0xe8e0d0 });
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3.2, 26, 10), mat);
      tower.position.y = 13;
      group.add(tower);
      const lampMat = new THREE.MeshStandardMaterial({ color: 0xffee88, emissive: 0xffaa00, emissiveIntensity: 2 });
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(2, 8, 8), lampMat);
      lamp.position.y = 27;
      group.add(lamp);
      const light = new THREE.PointLight(0xffcc66, 2, 80);
      light.position.y = 27;
      group.add(light);
    } else if (theme === 'haunted_circuit') {
      const mat = new THREE.MeshStandardMaterial({ color: 0xe8e8e8 });
      const skull = new THREE.Mesh(new THREE.SphereGeometry(8, 10, 8), mat);
      skull.position.y = 16;
      skull.scale.set(1, 1.1, 0.9);
      group.add(skull);
      const jawMat = new THREE.MeshStandardMaterial({ color: 0xcfcfcf });
      const jaw = new THREE.Mesh(new THREE.BoxGeometry(9, 3, 6), jawMat);
      jaw.position.y = 9;
      group.add(jaw);
    } else {
      const mat = new THREE.MeshStandardMaterial({ color: this.groundColor.clone().offsetHSL(0, 0, 0.2) });
      const spire = new THREE.Mesh(new THREE.ConeGeometry(6, 30, 8), mat);
      spire.position.y = 15;
      group.add(spire);
    }

    this.scene.add(group);
  }

  update(dt) {
    this.elapsed += dt;

    for (const b of this.crumblingBridges) {
      if (b.collapsed) {
        b.mesh.position.copy(b.body.position);
        b.mesh.quaternion.copy(b.body.quaternion);
      }
    }

    for (const pad of this.boostPads) {
      if (pad.flashTimer > 0) {
        pad.flashTimer = Math.max(0, pad.flashTimer - dt);
        pad.mat.emissiveIntensity = 1 + pad.flashTimer * 6;
      }
    }

    if (this.weather) {
      const w = this.weather;
      const { positions, cfg, topY, bottomY, halfX, halfZ, cx, cz } = w;
      for (let i = 0; i < positions.length / 3; i++) {
        positions[i * 3] += Math.sin(this.elapsed + i) * cfg.drift * dt;
        positions[i * 3 + 1] -= cfg.fall * dt;
        if (positions[i * 3 + 1] < bottomY) {
          positions[i * 3] = cx + (Math.random() * 2 - 1) * halfX;
          positions[i * 3 + 1] = topY;
          positions[i * 3 + 2] = cz + (Math.random() * 2 - 1) * halfZ;
        }
      }
      w.points.geometry.attributes.position.needsUpdate = true;
    }
  }
}
