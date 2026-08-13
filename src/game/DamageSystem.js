import * as THREE from 'three';
import * as CANNON from 'cannon-es';

// Damage stages as cumulative HP thresholds (0-100). Crossing a threshold
// triggers a one-time visual/behavioral change; past the last one, the car
// is eliminated.
const STAGES = [
  { hp: 25, darken: 0, detachPart: null, handlingPenalty: 0 },
  { hp: 50, darken: 0.35, detachPart: null, handlingPenalty: 0 },
  { hp: 75, darken: 0.55, detachPart: 'hood', handlingPenalty: 0.2 },
  { hp: 100, darken: 0.8, detachPart: 'spoiler', handlingPenalty: 0.4 },
];

export class DamageSystem {
  constructor(car, scene, world) {
    this.car = car;
    this.scene = scene;
    this.world = world;
    this.hp = 0;
    this.stageIndex = -1;
    this.eliminated = false;
    this.debris = [];
  }

  applyDamage(amount) {
    if (this.eliminated || amount <= 0) return;
    this.hp = Math.min(100, this.hp + amount);
    this._checkStageTransitions();
  }

  _checkStageTransitions() {
    while (this.stageIndex < STAGES.length - 1 && this.hp >= STAGES[this.stageIndex + 1].hp) {
      this.stageIndex += 1;
      this._onStageEnter(STAGES[this.stageIndex]);
    }
  }

  _onStageEnter(stage) {
    const baseColor = this.car.baseColor;
    const darkened = baseColor.clone().lerp(new THREE.Color(0x1a1a1a), stage.darken);
    this.car.chassisMesh.material.color.copy(darkened);

    if (stage.detachPart) {
      this._detachPart(stage.detachPart);
    }

    this.car.handlingPenalty = stage.handlingPenalty;

    if (this.hp >= 100) {
      this._eliminate();
    }
  }

  _detachPart(name) {
    const part = this.car.parts[name];
    if (!part || part.detached) return;
    part.detached = true;

    const worldPos = new THREE.Vector3();
    part.mesh.getWorldPosition(worldPos);
    const worldQuat = new THREE.Quaternion();
    part.mesh.getWorldQuaternion(worldQuat);

    this.car.group.remove(part.mesh);
    part.mesh.position.copy(worldPos);
    part.mesh.quaternion.copy(worldQuat);
    this.scene.add(part.mesh);

    const body = new CANNON.Body({
      mass: 1,
      position: new CANNON.Vec3(worldPos.x, worldPos.y, worldPos.z),
      shape: new CANNON.Box(new CANNON.Vec3(0.15, 0.1, 0.15)),
    });
    const carVel = this.car.physics.chassisBody.velocity;
    body.velocity.set(
      carVel.x + (Math.random() - 0.5) * 2,
      carVel.y + 2 + Math.random() * 2,
      carVel.z + (Math.random() - 0.5) * 2
    );
    body.angularVelocity.set(
      (Math.random() - 0.5) * 6,
      (Math.random() - 0.5) * 6,
      (Math.random() - 0.5) * 6
    );
    this.world.addBody(body);

    this.debris.push({ mesh: part.mesh, body, life: 3 });
  }

  _eliminate() {
    this.eliminated = true;
    this.car.eliminated = true;
  }

  update(dt) {
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.mesh.position.copy(d.body.position);
      d.mesh.quaternion.copy(d.body.quaternion);
      d.life -= dt;
      if (d.life <= 0) {
        this.scene.remove(d.mesh);
        this.world.removeBody(d.body);
        this.debris.splice(i, 1);
      }
    }
  }
}
