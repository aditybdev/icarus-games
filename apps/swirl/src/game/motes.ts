/**
 * Ambient dust motes: one THREE.Points draw call with pre-allocated
 * buffers. Each mote drifts on a slow sine path around a fixed base
 * position, so `update(time)` is fully allocation-free.
 */
import * as THREE from 'three';

const COUNT = 140;

export class Motes {
  readonly points: THREE.Points;
  private readonly base = new Float32Array(COUNT * 3);
  private readonly amp = new Float32Array(COUNT * 3);
  private readonly speed = new Float32Array(COUNT * 3);
  private readonly phase = new Float32Array(COUNT * 3);

  constructor() {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i += 1) {
      const i3 = i * 3;
      // Spread through the play volume, biased behind the cone.
      this.base[i3] = (Math.random() * 2 - 1) * 7;
      this.base[i3 + 1] = 0.4 + Math.random() * 8.4;
      this.base[i3 + 2] = -4.5 + Math.random() * 6;
      this.amp[i3] = 0.25 + Math.random() * 0.45;
      this.amp[i3 + 1] = 0.15 + Math.random() * 0.3;
      this.amp[i3 + 2] = 0.1 + Math.random() * 0.25;
      this.speed[i3] = 0.15 + Math.random() * 0.35;
      this.speed[i3 + 1] = 0.1 + Math.random() * 0.3;
      this.speed[i3 + 2] = 0.1 + Math.random() * 0.2;
      this.phase[i3] = Math.random() * Math.PI * 2;
      this.phase[i3 + 1] = Math.random() * Math.PI * 2;
      this.phase[i3 + 2] = Math.random() * Math.PI * 2;
      positions[i3] = this.base[i3];
      positions[i3 + 1] = this.base[i3 + 1];
      positions[i3 + 2] = this.base[i3 + 2];
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xfff2d8,
      size: 0.06,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
  }

  /** Advance the drift; call once per frame from World.render. */
  update(time: number): void {
    const attr = this.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    const a = attr.array as Float32Array;
    for (let i = 0; i < COUNT * 3; i += 1) {
      a[i] = this.base[i] + Math.sin(time * this.speed[i] + this.phase[i]) * this.amp[i];
    }
    attr.needsUpdate = true;
  }
}
