import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { createCarPhysics } from '../physics/CarPhysics.js';

export class Car {
  constructor(world, carMaterial, scene, options = {}) {
    const { color = 0x2299ee, chassisSize = [1.3, 0.4, 0.7] } = options;
    const [hx, hy, hz] = chassisSize;
    this.physics = createCarPhysics(world, carMaterial, {
      ...options,
      chassisSize: new CANNON.Vec3(hx, hy, hz),
    });
    this.baseColor = new THREE.Color(color);
    this.handlingPenalty = 0;
    this.eliminated = false;

    // Hood/spoiler offsets scale with chassis half-length so proportions
    // hold across the differently-sized car defs, not just the baseline car.
    const scaleX = hx / 1.3;

    this.group = new THREE.Group();

    const chassisMesh = new THREE.Mesh(
      new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2),
      new THREE.MeshStandardMaterial({ color })
    );
    chassisMesh.position.y = hy * 0.6;
    this.chassisMesh = chassisMesh;
    this.group.add(chassisMesh);

    // Detachable damage parts, named so DamageSystem can pop them off on hits.
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

    const wheelGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.35, 16);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
    // Wheels are independent physics bodies in world space (not parented to
    // the chassis), so their meshes are added directly to the scene rather
    // than as children of this.group to avoid double-applying the chassis transform.
    this.wheelMeshes = this.physics.wheels.map(() => {
      const mesh = new THREE.Mesh(wheelGeo, wheelMat);
      scene.add(mesh);
      return mesh;
    });

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
    const { chassisBody, wheels } = this.physics;
    this.group.position.copy(chassisBody.position);
    this.group.quaternion.copy(chassisBody.quaternion);

    wheels.forEach((wheel, i) => {
      const mesh = this.wheelMeshes[i];
      mesh.position.copy(wheel.body.position);
      mesh.quaternion.copy(wheel.body.quaternion);
      mesh.rotateX(Math.PI / 2);
    });
  }

  get position() {
    return this.physics.chassisBody.position;
  }

  /**
   * Resets the car to a safe position with zero velocity/rotation. Used as
   * a fall-off-track recovery (missed jump, tunneled through geometry) so a
   * bad landing is never a permanent soft-lock.
   */
  respawnAt(x, y) {
    const { chassisBody, wheels } = this.physics;
    chassisBody.position.set(x, y, 0);
    chassisBody.velocity.set(0, 0, 0);
    chassisBody.angularVelocity.set(0, 0, 0);
    chassisBody.quaternion.set(0, 0, 0, 1);

    const wheelBase = wheels.length > 1 ? this.physics.wheelBase : 0;
    wheels.forEach((wheel, i) => {
      const offset = wheelBase * (i - (wheels.length - 1) / 2);
      wheel.body.position.set(x + offset, y - 0.1, 0);
      wheel.body.velocity.set(0, 0, 0);
      wheel.body.angularVelocity.set(0, 0, 0);
      wheel.body.quaternion.set(0, 0, 0, 1);
    });
  }
}
