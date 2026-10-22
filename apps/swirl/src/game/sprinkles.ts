/**
 * Perfect-serve sprinkle burst: one THREE.Points draw call with a
 * pre-allocated buffer. `burst` re-arms the fixed pools (the only
 * allocation-free path after construction); `update` advances gravity +
 * fade and hides the points when every particle dies.
 */
import * as THREE from 'three';

const COUNT = 120;
const GRAVITY = 6.5;

export class Sprinkles {
  readonly points: THREE.Points;
  private readonly velocities = new Float32Array(COUNT * 3);
  private readonly life = new Float32Array(COUNT);
  private active = false;

  constructor() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(COUNT * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(COUNT * 3), 3));
    const mat = new THREE.PointsMaterial({
      size: 0.09,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.visible = false;
    this.points.frustumCulled = false;
  }

  /** Fire the burst from `origin` with colors round-robined from `palette`. */
  burst(origin: THREE.Vector3, palette: number[]): void {
    const pos = this.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    const col = this.points.geometry.getAttribute('color') as THREE.BufferAttribute;
    const c = new THREE.Color();
    for (let i = 0; i < COUNT; i += 1) {
      pos.setXYZ(i, origin.x, origin.y, origin.z);
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.5;
      const speed = 2.2 + Math.random() * 2.8;
      this.velocities[i * 3] = Math.cos(theta) * Math.sin(phi) * speed;
      this.velocities[i * 3 + 1] = Math.cos(phi) * speed * 0.9 + 1.2;
      this.velocities[i * 3 + 2] = Math.sin(theta) * Math.sin(phi) * speed * 0.6;
      this.life[i] = 0.7 + Math.random() * 0.5;
      c.setHex(palette[i % palette.length]);
      col.setXYZ(i, c.r, c.g, c.b);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    this.active = true;
    this.points.visible = true;
  }

  update(dt: number): void {
    if (!this.active || dt <= 0) return;
    const pos = this.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    let alive = 0;
    for (let i = 0; i < COUNT; i += 1) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      this.velocities[i * 3 + 1] -= GRAVITY * dt;
      pos.setXYZ(
        i,
        pos.getX(i) + this.velocities[i * 3] * dt,
        pos.getY(i) + this.velocities[i * 3 + 1] * dt,
        pos.getZ(i) + this.velocities[i * 3 + 2] * dt,
      );
      if (this.life[i] > 0) alive += 1;
    }
    pos.needsUpdate = true;
    if (alive === 0) {
      this.active = false;
      this.points.visible = false;
    }
  }
}
