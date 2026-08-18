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
  constructor(world, scene, groundMaterial, data, loopMaterial) {
    this.world = world;
    this.scene = scene;
    this.groundMaterial = groundMaterial;
    this.loopMaterial = loopMaterial ?? groundMaterial;
    this.data = data;
    this.movingPlatforms = [];
    this.crumblingBridges = [];
    this.lastHazardHit = new WeakMap();
    this.elapsed = 0;

    this.groundColor = new THREE.Color(data.groundColor ?? '#3a3a3a');
    this.skyColor = new THREE.Color(data.skyColor ?? '#87ceeb');
    this.fogColor = new THREE.Color(data.fogColor ?? data.skyColor ?? '#87ceeb');

    this.waypoints = new Waypoints(data.path);

    this._buildTerrainSkirt();
    this._buildGround();
    this._buildFeatures();
    this._buildHazards();
    this._buildSafetyFloor();
    this._buildDirectionArrows();
    this._buildRoadsideProps();
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
   * or fall through — the same "tiled terrain seam" failure the loop
   * feature below was already written to avoid with a compound body.
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
  }

  _buildFlat(a, b, width) {
    const { center, quaternion, length, up } = segmentBasis(a, b);
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

    const railHeight = 0.7;
    for (const side of [-1, 1]) {
      const railCenter = new THREE.Vector3()
        .copy(center)
        .addScaledVector(right, side * halfWidth)
        .addScaledVector(up, railHeight / 2);
      this.groundBody.addShape(
        new CANNON.Box(new CANNON.Vec3(length / 2, railHeight / 2, 0.15)),
        toCannonVec(railCenter),
        toCannonQuat(quaternion)
      );

      const railMesh = new THREE.Mesh(
        new THREE.BoxGeometry(length, railHeight, 0.3),
        new THREE.MeshStandardMaterial({ color: 0x9a8a70 })
      );
      railMesh.position.copy(railCenter);
      railMesh.quaternion.copy(quaternion);
      railMesh.castShadow = true;
      this.scene.add(railMesh);
    }

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
    this._buildFlat(a, b, width);
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
      this.groundBody.addShape(
        new CANNON.Box(new CANNON.Vec3(length / 2, clearance / 2, wallThickness / 2)),
        toCannonVec(wallCenter),
        toCannonQuat(quaternion)
      );

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

  _buildFeatures() {
    for (const feature of this.data.features ?? []) {
      if (feature.type === 'loop') this._buildLoop(feature);
    }
  }

  /**
   * A single compound body (many shapes on one Body), not one Body per
   * ring segment, so a fast car touching 2-3 of them at once doesn't get
   * contradictory contact resolution from the solver. Built in the plane
   * containing the path's forward and up vectors at `atIndex`, so it reads
   * as a loop-the-loop in the car's direction of travel; angle=0 is the
   * bottom, tangent to the road so incoming track connects smoothly.
   */
  _buildLoop(feature) {
    const segCount = feature.segCount ?? 32;
    const radius = feature.radius;
    const width = feature.width ?? this.data.path[feature.atIndex]?.width ?? 10;
    const { forward, up, right } = this._hazardFrame(feature.atIndex, 1);
    const nodePos = this._pathNode(feature.atIndex);
    const ringCenter = new THREE.Vector3().copy(nodePos).addScaledVector(up, radius);
    const thickness = (2 * Math.PI * radius) / segCount;
    // Track "wall" radial thickness scales with radius instead of a fixed
    // 0.6 — on a small loop, a fixed 0.6 half-extent is a huge fraction of
    // the radius and makes segments protrude much further into the car's
    // approach path than the visual ring suggests.
    const radialHalfExtent = Math.max(0.15, Math.min(0.6, radius * 0.1));

    const loopBody = new CANNON.Body({ type: CANNON.Body.STATIC, material: this.loopMaterial });
    const shape = new CANNON.Box(new CANNON.Vec3(thickness * 0.85, radialHalfExtent, width / 2));

    for (let i = 0; i < segCount; i++) {
      const angle = (i / segCount) * Math.PI * 2;
      const localOffset = new THREE.Vector3()
        .addScaledVector(forward, Math.sin(angle) * radius)
        .addScaledVector(up, -Math.cos(angle) * radius);
      const ringTangent = new THREE.Vector3()
        .addScaledVector(forward, Math.cos(angle))
        .addScaledVector(up, Math.sin(angle))
        .normalize();
      const ringRadial = new THREE.Vector3()
        .addScaledVector(forward, Math.sin(angle))
        .addScaledVector(up, -Math.cos(angle))
        .normalize();
      const segQuat = new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(ringTangent, ringRadial, right)
      );
      loopBody.addShape(shape, toCannonVec(localOffset), toCannonQuat(segQuat));

      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(thickness * 1.7, radialHalfExtent * 2, width),
        new THREE.MeshStandardMaterial({ color: this.groundColor.clone().offsetHSL(0, 0, 0.15) })
      );
      mesh.position.copy(ringCenter).add(localOffset);
      mesh.quaternion.copy(segQuat);
      this.scene.add(mesh);
    }

    loopBody.position.copy(toCannonVec(ringCenter));
    this.world.addBody(loopBody);

    // Marks the car as "on the loop" so CarPhysics can suspend flip-recovery
    // — which would otherwise fight the legitimate full-360° rotation a
    // loop requires.
    loopBody.addEventListener('collide', (event) => {
      const car = event.body.userData?.car;
      if (car) car.physics.chassisBody.userData.touchingLoop = true;
    });
  }

  _buildHazards() {
    for (const hazard of this.data.hazards ?? []) {
      if (hazard.type === 'spikePit') this._buildSpikePit(hazard);
      else if (hazard.type === 'movingPlatform') this._buildMovingPlatform(hazard);
      else if (hazard.type === 'boostPad') this._buildBoostPad(hazard);
    }
  }

  _buildSpikePit(hazard) {
    const span = hazard.spanNodes ?? 1;
    const width = hazard.width ?? this.data.path[hazard.atIndex]?.width ?? 10;
    const { center, quaternion, length, up } = this._hazardFrame(hazard.atIndex, span);
    const pitCenter = new THREE.Vector3().copy(center).addScaledVector(up, -3);

    const body = new CANNON.Body({
      type: CANNON.Body.STATIC,
      collisionResponse: false,
      shape: new CANNON.Box(new CANNON.Vec3(length / 2, 1, width / 2)),
      position: toCannonVec(pitCenter),
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
      mesh.position.copy(a).lerp(b, t).addScaledVector(up, -3);
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
   * its own topSpeed stat. Used ahead of hazards (like the loop) that need
   * more entry speed than every car's own drivetrain can reach.
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

    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(length, 0.15, width),
      new THREE.MeshStandardMaterial({ color: 0x33ffcc, emissive: 0x116644 })
    );
    mesh.position.copy(center).addScaledVector(up, 0.1);
    mesh.quaternion.copy(quaternion);
    this.scene.add(mesh);

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
    });
  }

  _buildMovingPlatform(hazard) {
    const span = hazard.spanNodes ?? 1;
    const width = hazard.width ?? this.data.path[hazard.atIndex]?.width ?? 6;
    const { center, quaternion, length, up, right } = this._hazardFrame(hazard.atIndex, span);

    const body = new CANNON.Body({
      type: CANNON.Body.KINEMATIC,
      shape: new CANNON.Box(new CANNON.Vec3(length / 2, 0.25, width / 2)),
      material: this.groundMaterial,
      position: toCannonVec(center),
      quaternion: toCannonQuat(quaternion),
    });
    this.world.addBody(body);

    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(length, 0.5, width),
      new THREE.MeshStandardMaterial({ color: 0x4488cc })
    );
    this.scene.add(mesh);

    this.movingPlatforms.push({
      body,
      mesh,
      base: center.clone(),
      axisVec: (hazard.axis === 'lateral' ? right : up).clone(),
      amplitude: hazard.amplitude ?? 2,
      period: hazard.period ?? 3,
      quaternion,
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

  update(dt) {
    this.elapsed += dt;

    for (const p of this.movingPlatforms) {
      const t = (this.elapsed / p.period) * Math.PI * 2;
      const offset = Math.sin(t) * p.amplitude;
      const pos = new THREE.Vector3().copy(p.base).addScaledVector(p.axisVec, offset);
      p.body.position.copy(toCannonVec(pos));
      p.mesh.position.copy(pos);
      p.mesh.quaternion.copy(p.quaternion);
    }

    for (const b of this.crumblingBridges) {
      if (b.collapsed) {
        b.mesh.position.copy(b.body.position);
        b.mesh.quaternion.copy(b.body.quaternion);
      }
    }
  }
}
