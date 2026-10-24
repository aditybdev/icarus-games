/**
 * The soft-serve swirl: ONE continuous tube mesh extruded along a growing
 * Archimedean-ish spiral curve. Geometry is rebuilt (throttled by the caller)
 * as the swirl grows; radius tapers toward the top and the finished swirl
 * ends in a rounded peak. Never stacked tori.
 */
import * as THREE from 'three';
import { FLAVOR_COLORS, type Flavor } from '../core/orders';

/** Radius of the lowest spiral loop (world units). */
const BASE_LOOP_RADIUS = 0.55;
/** Radius of the topmost loop before the peak collapse. */
const TOP_LOOP_RADIUS = 0.1;
/** Vertical rise of one full spiral turn. */
const LOOP_HEIGHT = 0.52;
/** Tube radius at the bottom / top. */
const TUBE_BASE_RADIUS = 0.3;
const TUBE_TOP_RADIUS = 0.16;
/** Peak tube radius when finished (rounded tip). */
const TUBE_TIP_RADIUS = 0.05;
/** How strongly wobble leans the top of the swirl sideways. */
const LEAN_SCALE = 0.38;
/** Rebuild resolution caps. */
const MAX_SEGMENTS = 320;
const RADIAL_SEGMENTS = 10;
/** Starting angle so the first loop sits toward the camera. */
const PHASE = Math.PI * 0.5;

/**
 * Spiral curve parametrised so existing loops never move as it grows:
 * the turn angle depends on absolute height (t * h), not on t alone.
 */
export class SwirlCurve extends THREE.Curve<THREE.Vector3> {
  constructor(
    readonly height: number,
    readonly lean: number,
    readonly finished: boolean,
  ) {
    super();
  }

  override getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    const h = Math.max(0.06, this.height);
    const y = t * h;
    const theta = PHASE + (y / LOOP_HEIGHT) * Math.PI * 2;
    let loopRadius = THREE.MathUtils.lerp(
      BASE_LOOP_RADIUS,
      TOP_LOOP_RADIUS,
      Math.pow(t, 0.85),
    );
    if (this.finished) {
      // Collapse the spiral to a central point for the final peak.
      const k = THREE.MathUtils.smoothstep(t, 0.86, 1);
      loopRadius *= 1 - k;
    }
    const leanX = this.lean * LEAN_SCALE * t * t;
    const x = Math.cos(theta) * loopRadius + leanX;
    const z = Math.sin(theta) * loopRadius * 0.92;
    return target.set(x, y, z);
  }
}

/** Tube radius profile along the curve. */
function tubeRadius(t: number, finished: boolean): number {
  const r = THREE.MathUtils.lerp(TUBE_BASE_RADIUS, TUBE_TOP_RADIUS, Math.pow(t, 0.9));
  if (!finished) return r;
  const k = THREE.MathUtils.smoothstep(t, 0.88, 1);
  return THREE.MathUtils.lerp(r, TUBE_TIP_RADIUS, k);
}

/**
 * Reusable tube builder: all buffers are preallocated once at the maximum
 * resolution and refilled in place on every rebuild. Rebuilds happen ~11x/sec
 * while dispensing, so allocating fresh geometry each time (as the original
 * code did) meant ~640 Vector3s, ~84KB of typed arrays, a 19k-entry index
 * array AND a create/delete cycle of 4 WebGL buffers per rebuild — pure GC
 * and driver churn. `drawRange` selects how much of the shared index buffer
 * is rendered; the geometry itself never changes size.
 */
class TubeBuilder {
  private readonly ringVerts = RADIAL_SEGMENTS + 1;
  private readonly ringCount = MAX_SEGMENTS + 1;
  readonly geometry = new THREE.BufferGeometry();
  private readonly positions: THREE.BufferAttribute;
  private readonly normals: THREE.BufferAttribute;
  private readonly uvs: THREE.BufferAttribute;
  private readonly points: THREE.Vector3[] = [];
  private readonly tangents: THREE.Vector3[] = [];
  private readonly seedY = new THREE.Vector3(0, 1, 0);
  private readonly seedX = new THREE.Vector3(1, 0, 0);
  private readonly normal = new THREE.Vector3();
  private readonly binormal = new THREE.Vector3();

  constructor() {
    const vertCount = this.ringCount * this.ringVerts;
    this.positions = new THREE.BufferAttribute(new Float32Array(vertCount * 3), 3);
    this.normals = new THREE.BufferAttribute(new Float32Array(vertCount * 3), 3);
    this.uvs = new THREE.BufferAttribute(new Float32Array(vertCount * 2), 2);
    this.positions.setUsage(THREE.DynamicDrawUsage);
    this.normals.setUsage(THREE.DynamicDrawUsage);
    this.uvs.setUsage(THREE.DynamicDrawUsage);
    // Max-resolution index buffer, built once; the winding pattern is
    // resolution-independent so a partial drawRange renders a shorter tube.
    const indices = new Uint16Array(MAX_SEGMENTS * RADIAL_SEGMENTS * 6);
    let k = 0;
    for (let i = 0; i < MAX_SEGMENTS; i += 1) {
      for (let j = 0; j < RADIAL_SEGMENTS; j += 1) {
        const a = i * this.ringVerts + j;
        const b = a + this.ringVerts;
        indices[k] = a;
        indices[k + 1] = b;
        indices[k + 2] = a + 1;
        indices[k + 3] = b;
        indices[k + 4] = b + 1;
        indices[k + 5] = a + 1;
        k += 6;
      }
    }
    this.geometry.setAttribute('position', this.positions);
    this.geometry.setAttribute('normal', this.normals);
    this.geometry.setAttribute('uv', this.uvs);
    this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    this.geometry.setDrawRange(0, 0);
    for (let i = 0; i < this.ringCount; i += 1) {
      this.points.push(new THREE.Vector3());
      this.tangents.push(new THREE.Vector3());
    }
  }

  /**
   * Refill the shared buffers for `curve` at `segments` resolution using
   * parallel-transport frames (stable for our mostly-vertical helix, no
   * twisting artifacts). Allocation-free.
   */
  rebuild(
    curve: SwirlCurve,
    segments: number,
    radiusAt: (t: number) => number,
  ): void {
    const ringVerts = this.ringVerts;
    const points = this.points;
    const tangents = this.tangents;
    for (let i = 0; i <= segments; i += 1) {
      curve.getPoint(i / segments, points[i]);
    }

    // Tangents via central differences.
    for (let i = 0; i <= segments; i += 1) {
      const prev = points[Math.max(0, i - 1)];
      const next = points[Math.min(segments, i + 1)];
      tangents[i].subVectors(next, prev).normalize();
    }

    // Initial normal: any unit vector perpendicular to the first tangent.
    const t0 = tangents[0];
    const seed = Math.abs(t0.y) < 0.9 ? this.seedY : this.seedX;
    const normal = this.normal.crossVectors(seed, t0).normalize();
    const binormal = this.binormal;

    const pos = this.positions.array as Float32Array;
    const nor = this.normals.array as Float32Array;
    const uv = this.uvs.array as Float32Array;
    let p = 0;
    let q = 0;
    for (let i = 0; i <= segments; i += 1) {
      const t = i / segments;
      // Parallel transport: project the previous normal onto the plane
      // perpendicular to the current tangent.
      const tangent = tangents[i];
      normal.addScaledVector(tangent, -normal.dot(tangent));
      if (normal.lengthSq() < 1e-8) {
        normal.crossVectors(seed, tangent).normalize();
      } else {
        normal.normalize();
      }
      binormal.crossVectors(tangent, normal).normalize();

      const center = points[i];
      const radius = radiusAt(t);
      for (let j = 0; j <= RADIAL_SEGMENTS; j += 1) {
        const angle = (j / RADIAL_SEGMENTS) * Math.PI * 2;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const nx = normal.x * cos + binormal.x * sin;
        const ny = normal.y * cos + binormal.y * sin;
        const nz = normal.z * cos + binormal.z * sin;
        pos[p] = center.x + nx * radius;
        pos[p + 1] = center.y + ny * radius;
        pos[p + 2] = center.z + nz * radius;
        nor[p] = nx;
        nor[p + 1] = ny;
        nor[p + 2] = nz;
        p += 3;
        uv[q] = j / RADIAL_SEGMENTS;
        uv[q + 1] = t * 8;
        q += 2;
      }
    }
    this.positions.needsUpdate = true;
    this.normals.needsUpdate = true;
    this.uvs.needsUpdate = true;
    this.geometry.setDrawRange(0, segments * RADIAL_SEGMENTS * 6);
  }
}

export class SwirlMesh {
  readonly group = new THREE.Group();
  private readonly material: THREE.MeshPhysicalMaterial;
  private readonly builder = new TubeBuilder();
  private readonly tube: THREE.Mesh;
  private hasTube = false;
  private readonly tip: THREE.Mesh;

  constructor() {
    // Creamy soft-serve look: soft sheen backscatter + a subtle clearcoat
    // so highlights roll gently across the ridges. Flavor color still comes
    // straight from FLAVOR_COLORS via setFlavor / the swirlMaterial getter.
    this.material = new THREE.MeshPhysicalMaterial({
      color: FLAVOR_COLORS.vanilla,
      roughness: 0.34,
      metalness: 0,
      sheen: 0.55,
      sheenRoughness: 0.5,
      sheenColor: new THREE.Color(0xfffaf2),
      clearcoat: 0.22,
      clearcoatRoughness: 0.55,
    });
    this.tube = new THREE.Mesh(this.builder.geometry, this.material);
    this.tube.castShadow = true;
    this.tube.visible = false;
    // The swirl is always near screen center; skip per-frame bounding work
    // (the shared geometry's bounds would be stale anyway between rebuilds).
    this.tube.frustumCulled = false;
    this.group.add(this.tube);
    this.tip = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 14), this.material);
    this.tip.castShadow = true;
    this.tip.visible = false;
    this.group.add(this.tip);
  }

  get swirlMaterial(): THREE.MeshStandardMaterial {
    return this.material;
  }

  setFlavor(flavor: Flavor): void {
    this.material.color.setHex(FLAVOR_COLORS[flavor]);
  }

  /** Local-space position of the swirl tip (for the dispense strand). */
  get tipPosition(): THREE.Vector3 {
    return this.tip.position;
  }

  get visibleHeight(): boolean {
    return this.hasTube;
  }

  /**
   * Rebuild the tube for the current height/lean. Caller is responsible for
   * throttling (~10x/sec while growing). Buffers are refilled in place.
   */
  rebuild(height: number, lean: number, finished: boolean): void {
    const h = Math.max(0.06, height);
    const curve = new SwirlCurve(h, lean, finished);
    const segments = Math.min(MAX_SEGMENTS, Math.max(40, Math.round(h * 56)));
    this.builder.rebuild(curve, segments, (t) => tubeRadius(t, finished));
    this.hasTube = true;
    this.tube.visible = true;
    const tipPoint = curve.getPoint(1, this.tip.position);
    this.tip.position.copy(tipPoint);
    this.tip.scale.setScalar(tubeRadius(1, finished) * 1.1);
    this.tip.visible = true;
  }

  /** Remove the swirl entirely (start of a new round). */
  reset(): void {
    this.hasTube = false;
    this.tube.visible = false;
    this.builder.geometry.setDrawRange(0, 0);
    this.tip.visible = false;
    this.group.rotation.set(0, 0, 0);
  }

  dispose(): void {
    this.reset();
    this.builder.geometry.dispose();
    this.tip.geometry.dispose();
    this.material.dispose();
  }
}
