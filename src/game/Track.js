import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { Waypoints } from '../ai/Waypoints.js';

const HAZARD_HIT_COOLDOWN = 1; // seconds, prevents repeated damage from one overlap

/**
 * Parses a data-driven track JSON into Three.js geometry + cannon-es bodies.
 * groundSegments form the continuous drivable path (flat / gap / crumbling);
 * features are additive standalone obstacles (ramp / loop) sitting on top of
 * the ground; hazards are damage sources (spike pit / moving platform).
 * New segment/hazard types are additive here without touching track JSON
 * for existing tracks.
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
    this.hazardTriggers = [];
    this.lastHazardHit = new WeakMap();
    this.elapsed = 0;

    this.groundColor = new THREE.Color(data.groundColor ?? '#3a3a3a');
    this.skyColor = new THREE.Color(data.skyColor ?? '#87ceeb');
    this.fogColor = new THREE.Color(data.fogColor ?? data.skyColor ?? '#87ceeb');

    this._buildGround();
    this._buildFeatures();
    this._buildHazards();
    this._buildSafetyFloor();
    this._buildDirectionArrows();

    this.waypoints = new Waypoints(data.waypoints);
  }

  /**
   * Ground-level chevrons pointing +X (the direction of travel). Purely
   * visual (no physics body) and driven entirely by groundSegments already
   * in the track JSON, so every track gets them automatically. They sit in
   * the X/Y plane facing the camera — a decal flat on the ground (X/Z
   * plane) would be nearly invisible from this game's fixed side view.
   */
  _buildDirectionArrows() {
    const spacing = 18;
    const geo = new THREE.ConeGeometry(0.5, 1.2, 3);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffee88,
      emissive: 0x554400,
    });

    for (const seg of this.data.groundSegments) {
      if (seg.type === 'gap') continue;
      for (let x = seg.x + spacing / 2; x < seg.x + seg.width; x += spacing) {
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, 0.6, 2);
        mesh.rotation.z = -Math.PI / 2; // cone tip (local +Y) now points along +X
        this.scene.add(mesh);
      }
    }
  }

  /**
   * A last-resort catch-all floor far below the track. Not meant to be
   * reachable in normal play — it exists so a physics tunneling glitch or a
   * missed jump into open space never turns into an infinite fall; falling
   * this far still triggers the same respawn path main.js uses for pits.
   */
  _buildSafetyFloor() {
    const xs = this.data.groundSegments.map((s) => s.x);
    const xe = this.data.groundSegments.map((s) => s.x + s.width);
    const minX = Math.min(...xs) - 50;
    const maxX = Math.max(...xe) + 50;
    const halfWidth = (maxX - minX) / 2;
    const body = new CANNON.Body({
      type: CANNON.Body.STATIC,
      shape: new CANNON.Box(new CANNON.Vec3(halfWidth, 5, 20)),
      position: new CANNON.Vec3(minX + halfWidth, -60, 0),
    });
    this.world.addBody(body);
  }

  _buildGround() {
    for (const seg of this.data.groundSegments) {
      if (seg.type === 'flat') this._buildFlat(seg);
      else if (seg.type === 'gap') continue; // intentional hole, no geometry
      else if (seg.type === 'crumblingBridge') this._buildCrumblingBridge(seg);
    }
  }

  _buildFlat(seg) {
    // Half-height is generously thick (not a thin slab) so a fast-falling
    // car can't tunnel through it in a single physics step.
    const halfHeight = 2;
    const halfWidth = seg.width / 2;
    const centerX = seg.x + halfWidth;
    const body = new CANNON.Body({
      type: CANNON.Body.STATIC,
      shape: new CANNON.Box(new CANNON.Vec3(halfWidth, halfHeight, 5)),
      material: this.groundMaterial,
      position: new CANNON.Vec3(centerX, -halfHeight, 0),
    });
    this.world.addBody(body);

    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(seg.width, halfHeight * 2, 10),
      new THREE.MeshStandardMaterial({ color: this.groundColor })
    );
    mesh.position.copy(body.position);
    this.scene.add(mesh);
  }

  _buildCrumblingBridge(seg) {
    const halfWidth = seg.width / 2;
    const centerX = seg.x + halfWidth;
    const body = new CANNON.Body({
      type: CANNON.Body.STATIC,
      shape: new CANNON.Box(new CANNON.Vec3(halfWidth, 0.3, 5)),
      material: this.groundMaterial,
      position: new CANNON.Vec3(centerX, -0.3, 0),
    });
    this.world.addBody(body);

    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(seg.width, 0.6, 10),
      new THREE.MeshStandardMaterial({ color: 0x7a5230 })
    );
    mesh.position.copy(body.position);
    this.scene.add(mesh);

    const bridge = { body, mesh, hits: 0, collapseAfterHits: seg.collapseAfterHits ?? 3, collapsed: false };
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
    bridge.body.linearFactor.set(1, 1, 0);
    bridge.body.angularFactor.set(0, 0, 1);
    bridge.body.wakeUp();
  }

  _buildFeatures() {
    for (const feature of this.data.features ?? []) {
      if (feature.type === 'ramp') this._buildRamp(feature);
      else if (feature.type === 'loop') this._buildLoop(feature);
    }
  }

  _buildRamp(feature) {
    const angleRad = (feature.angle * Math.PI) / 180;
    const length = feature.width / Math.cos(angleRad);
    const halfLength = length / 2;
    const centerX = feature.x + (feature.width / 2) * Math.cos(angleRad);
    const centerY = (feature.width / 2) * Math.tan(angleRad);

    const body = new CANNON.Body({
      type: CANNON.Body.STATIC,
      shape: new CANNON.Box(new CANNON.Vec3(halfLength, 0.25, 5)),
      material: this.groundMaterial,
      position: new CANNON.Vec3(centerX, centerY, 0),
    });
    body.quaternion.setFromEuler(0, 0, angleRad);
    this.world.addBody(body);

    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(length, 0.5, 10),
      new THREE.MeshStandardMaterial({ color: this.groundColor.clone().offsetHSL(0, 0, 0.08) })
    );
    mesh.position.copy(body.position);
    mesh.quaternion.copy(body.quaternion);
    this.scene.add(mesh);
  }

  _buildLoop(feature) {
    // A single compound body (many shapes on one Body), not one Body per
    // ring segment. With N independent static bodies, a fast car touching
    // 2-3 of them at once gets contradictory contact resolution from the
    // solver and can wedge in place — the classic "vehicle catches on
    // tiled terrain seams" failure. One body with N shapes resolves all of
    // them as a single rigid frame's contacts instead.
    const segCount = feature.segCount ?? 32;
    const radius = feature.radius;
    const centerX = feature.x + radius;
    const centerY = radius;
    const thickness = (2 * Math.PI * radius) / segCount;
    // Track "wall" radial thickness scales with radius instead of a fixed
    // 0.6 — on a small loop, a fixed 0.6 half-extent (1.2 total) is a huge
    // fraction of the radius and makes segments protrude much further into
    // the car's approach path than the visual ring suggests. Now a single
    // compound body (not per-segment bodies), thin segments no longer risk
    // tunneling the way they did with independent bodies.
    const radialHalfExtent = Math.max(0.15, Math.min(0.6, radius * 0.1));

    const loopBody = new CANNON.Body({
      type: CANNON.Body.STATIC,
      material: this.loopMaterial,
    });
    const shape = new CANNON.Box(new CANNON.Vec3(thickness * 0.85, radialHalfExtent, 5));

    for (let i = 0; i < segCount; i++) {
      // angle=0 is the bottom, tangent to the flat ground so incoming
      // track connects smoothly into the ring.
      const angle = (i / segCount) * Math.PI * 2;
      const offset = new CANNON.Vec3(Math.sin(angle) * radius, -Math.cos(angle) * radius, 0);
      const quat = new CANNON.Quaternion();
      quat.setFromEuler(0, 0, angle);
      loopBody.addShape(shape, offset, quat);

      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(thickness * 1.7, radialHalfExtent * 2, 10),
        new THREE.MeshStandardMaterial({ color: this.groundColor.clone().offsetHSL(0, 0, 0.15) })
      );
      mesh.position.set(centerX + offset.x, centerY + offset.y, 0);
      mesh.quaternion.copy(quat);
      this.scene.add(mesh);
    }

    loopBody.position.set(centerX, centerY, 0);
    this.world.addBody(loopBody);

    // Marks the car as "on the loop" so CarPhysics can suspend the
    // auto-level spring and flip-recovery kick — both would otherwise
    // fight the legitimate full-360° rotation a loop requires.
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

  /**
   * Sets a car's speed to a fixed target on contact, regardless of its own
   * topSpeed stat. Used ahead of hazards (like the loop) that need more
   * entry speed than every car's own drivetrain can reach — a standard
   * racing-game mechanic, and it lets the hazard's own geometry use a
   * gentler, larger radius instead of being sized down to the slowest car.
   */
  _buildBoostPad(hazard) {
    const halfWidth = hazard.width / 2;
    const centerX = hazard.x + halfWidth;
    const body = new CANNON.Body({
      type: CANNON.Body.STATIC,
      collisionResponse: false,
      shape: new CANNON.Box(new CANNON.Vec3(halfWidth, 0.6, 5)),
      position: new CANNON.Vec3(centerX, 0.3, 0),
    });
    this.world.addBody(body);

    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(hazard.width, 0.15, 10),
      new THREE.MeshStandardMaterial({ color: 0x33ffcc, emissive: 0x116644 })
    );
    mesh.position.set(centerX, 0.1, 0);
    this.scene.add(mesh);

    const boostSpeed = hazard.speed ?? 20;
    body.addEventListener('collide', (event) => {
      const car = event.body.userData?.car;
      if (!car) return;
      const last = this.lastHazardHit.get(car) ?? -Infinity;
      if (this.elapsed - last < HAZARD_HIT_COOLDOWN) return;
      this.lastHazardHit.set(car, this.elapsed);
      const cb = car.physics.chassisBody;
      if (cb.velocity.x < boostSpeed) {
        cb.velocity.x = boostSpeed;
        for (const wheel of car.physics.wheels) {
          wheel.body.velocity.x = boostSpeed;
          wheel.body.angularVelocity.z = boostSpeed / 0.45;
        }
      }
    });
  }

  _buildSpikePit(hazard) {
    const halfWidth = hazard.width / 2;
    const centerX = hazard.x + halfWidth;
    const body = new CANNON.Body({
      type: CANNON.Body.STATIC,
      collisionResponse: false,
      shape: new CANNON.Box(new CANNON.Vec3(halfWidth, 1, 5)),
      position: new CANNON.Vec3(centerX, -3, 0),
    });
    this.world.addBody(body);

    const spikeGeo = new THREE.ConeGeometry(0.3, 0.8, 4);
    const spikeMat = new THREE.MeshStandardMaterial({ color: 0x888888 });
    const spikeCount = Math.max(2, Math.floor(hazard.width / 1.2));
    for (let i = 0; i < spikeCount; i++) {
      const mesh = new THREE.Mesh(spikeGeo, spikeMat);
      mesh.position.set(hazard.x + 0.6 + i * 1.2, -3, 0);
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

  _buildMovingPlatform(hazard) {
    const halfWidth = hazard.width / 2;
    const centerX = hazard.x + halfWidth;
    const baseY = 0;
    const body = new CANNON.Body({
      type: CANNON.Body.KINEMATIC,
      shape: new CANNON.Box(new CANNON.Vec3(halfWidth, 0.25, 5)),
      material: this.groundMaterial,
      position: new CANNON.Vec3(centerX, baseY, 0),
    });
    this.world.addBody(body);

    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(hazard.width, 0.5, 10),
      new THREE.MeshStandardMaterial({ color: 0x4488cc })
    );
    this.scene.add(mesh);

    this.movingPlatforms.push({
      body,
      mesh,
      baseX: centerX,
      baseY,
      amplitude: hazard.amplitude ?? 2,
      period: hazard.period ?? 3,
      axis: hazard.axis ?? 'y',
    });
  }

  update(dt) {
    this.elapsed += dt;

    for (const p of this.movingPlatforms) {
      const t = (this.elapsed / p.period) * Math.PI * 2;
      const offset = Math.sin(t) * p.amplitude;
      if (p.axis === 'y') {
        p.body.position.set(p.baseX, p.baseY + offset, 0);
      } else {
        p.body.position.set(p.baseX + offset, p.baseY, 0);
      }
      p.mesh.position.copy(p.body.position);
      p.mesh.quaternion.copy(p.body.quaternion);
    }

    for (const b of this.crumblingBridges) {
      if (b.collapsed) {
        b.mesh.position.copy(b.body.position);
        b.mesh.quaternion.copy(b.body.quaternion);
      }
    }
  }
}
