import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { createCarPhysics } from '../physics/CarPhysics.js';

/**
 * A small always-facing-camera badge floating above a car, used to mark
 * which of the several cars on screen is Player 1 vs Player 2 — now that
 * the camera can be zoomed out far enough to keep both players in frame
 * (see TopDownCamera.js), telling the two apart at a glance needs more
 * than "it's the blue/red one" once other similarly-colored AI cars are
 * also on screen. depthTest is off so the badge stays visible even when
 * briefly behind another car or a hazard mesh.
 */
function createLabelSprite(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(64, 64, 54, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 8;
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 70px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 64, 70);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.7, 1.7, 1);
  sprite.renderOrder = 999;
  return sprite;
}

export class Car {
  constructor(world, carMaterial, scene, options = {}) {
    const { color = 0x2299ee, chassisSize = [1.3, 0.4, 0.7], label = null, labelColor = '#222222' } = options;
    const [hx, hy, hz] = chassisSize;
    this.physics = createCarPhysics(world, carMaterial, {
      ...options,
      chassisSize: new CANNON.Vec3(hx, hy, hz),
    });
    this.baseColor = new THREE.Color(color);
    this.handlingPenalty = 0;
    this.eliminated = false;
    this.pathHint = 0;
    this.lapProgress = 0;
    this._rawProgress = undefined;

    // Hood/spoiler offsets scale with chassis half-length so proportions
    // hold across the differently-sized car defs, not just the baseline car.
    const scaleX = hx / 1.3;

    this.group = new THREE.Group();

    const chassisMesh = new THREE.Mesh(
      new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2),
      new THREE.MeshStandardMaterial({ color })
    );
    chassisMesh.position.y = hy * 0.6;
    chassisMesh.castShadow = true;
    this.chassisMesh = chassisMesh;
    this.group.add(chassisMesh);

    // Detachable damage parts, named so DamageSystem can pop them off on hits.
    // Positioned toward local +X (forward) / -X (rear) to match the car's
    // forward axis under the new RaycastVehicle physics.
    const hoodMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.7 * scaleX, 0.15, hz * 1.85),
      new THREE.MeshStandardMaterial({ color })
    );
    hoodMesh.position.set(0.75 * scaleX, hy * 1.4, 0);
    this.group.add(hoodMesh);

    const spoilerMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.2 * scaleX, 0.35, hz * 1.85),
      new THREE.MeshStandardMaterial({ color: 0x222222 })
    );
    spoilerMesh.position.set(-1.1 * scaleX, hy * 1.4, 0);
    this.group.add(spoilerMesh);

    this.parts = {
      hood: { mesh: hoodMesh, detached: false },
      spoiler: { mesh: spoilerMesh, detached: false },
    };

    const wheelRadius = this.physics.wheelRadius;
    const wheelGeo = new THREE.CylinderGeometry(wheelRadius, wheelRadius, 0.32, 16);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
    // Wheels are virtual (raycast, not physics bodies) so their meshes are
    // added directly to the scene rather than as children of this.group,
    // and synced each frame from CANNON.RaycastVehicle's wheelInfos.
    this.wheelMeshes = this.physics.vehicle.wheelInfos.map(() => {
      const mesh = new THREE.Mesh(wheelGeo, wheelMat);
      mesh.castShadow = true;
      scene.add(mesh);
      return mesh;
    });

    // Positioned in world space each frame (like the wheels above), not as
    // a child of this.group, so a spin/flip never rotates the badge offset
    // sideways — it should only ever float straight up from the car.
    if (label) {
      this.labelSprite = createLabelSprite(label, labelColor);
      this.labelHeight = hy * 1.4 + 1.3;
      scene.add(this.labelSprite);
    }

    scene.add(this.group);
  }

  applyInput(input) {
    if (this.eliminated) {
      this.physics.applyInput({ throttle: 0, brake: 0, steer: 0, handbrake: true });
      return;
    }
    const scale = 1 - this.handlingPenalty;
    this.physics.applyInput({
      ...input,
      throttle: input.throttle * scale,
      steer: input.steer * scale,
    });
  }

  syncMeshes() {
    const { chassisBody, vehicle } = this.physics;
    this.group.position.copy(chassisBody.position);
    this.group.quaternion.copy(chassisBody.quaternion);

    vehicle.wheelInfos.forEach((wheel, i) => {
      vehicle.updateWheelTransform(i);
      const mesh = this.wheelMeshes[i];
      mesh.position.copy(wheel.worldTransform.position);
      mesh.quaternion.copy(wheel.worldTransform.quaternion);
      mesh.rotateX(Math.PI / 2);
    });

    if (this.labelSprite) {
      this.labelSprite.position.set(chassisBody.position.x, chassisBody.position.y + this.labelHeight, chassisBody.position.z);
    }
  }

  get position() {
    return this.physics.chassisBody.position;
  }

  /**
   * Nearest-point progress along `waypoints`, tracked with this car's own
   * `pathHint` so repeated calls stay a cheap windowed search instead of
   * re-scanning the whole path. `lapProgress` unwraps the path's 0..
   * totalLength wraparound into a monotonically increasing distance
   * traveled, so "finished" (a full lap) is just lapProgress >= totalLength
   * even though raw path progress resets to ~0 at the start/finish line.
   */
  updateTrackProgress(waypoints) {
    const loc = waypoints.locate(this.position, this.pathHint);
    this.pathHint = loc.index;
    if (this._rawProgress === undefined) {
      this.lapProgress = loc.progress;
    } else {
      let delta = loc.progress - this._rawProgress;
      if (delta < -waypoints.totalLength / 2) delta += waypoints.totalLength;
      else if (delta > waypoints.totalLength / 2) delta -= waypoints.totalLength;
      this.lapProgress += delta;
    }
    this._rawProgress = loc.progress;
    this.trackState = loc;
    return this.lapProgress;
  }

  /**
   * Resets the car to a safe position with zero velocity/rotation. Used as
   * a fall-off-track recovery (missed jump, tunneled through geometry) so a
   * bad landing is never a permanent soft-lock. `quaternion` should be
   * belly-parallel to the local road surface (see CarPhysics.js) so the
   * car doesn't spawn tilted relative to a sloped respawn point.
   */
  respawnAt(position, quaternion) {
    const { chassisBody } = this.physics;
    chassisBody.position.copy(position);
    chassisBody.velocity.set(0, 0, 0);
    chassisBody.angularVelocity.set(0, 0, 0);
    chassisBody.quaternion.copy(quaternion ?? new CANNON.Quaternion(0, 0, 0, 1));
  }
}
