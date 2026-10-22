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
 * Build a tube with a variable radius using parallel-transport frames
 * (stable for our mostly-vertical helix, no twisting artifacts).
 */
function buildTubeGeometry(
  curve: SwirlCurve,
  segments: number,
  radialSegments: number,
  radiusAt: (t: number) => number,
): THREE.BufferGeometry {
  const ringVerts = radialSegments + 1;
  const ringCount = segments + 1;
  const positions = new Float32Array(ringCount * ringVerts * 3);
  const normals = new Float32Array(ringCount * ringVerts * 3);
  const uvs = new Float32Array(ringCount * ringVerts * 2);
  const indices: number[] = [];

  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i += 1) {
    points.push(curve.getPoint(i / segments));
  }

  // Tangents via central differences.
  const tangents: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(segments, i + 1)];
    tangents.push(next.clone().sub(prev).normalize());
  }

  // Initial normal: any unit vector perpendicular to the first tangent.
  const t0 = tangents[0];
  const seed = Math.abs(t0.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  let normal = new THREE.Vector3().crossVectors(seed, t0).normalize();
  const binormal = new THREE.Vector3();

  let p = 0;
  let q = 0;
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    // Parallel transport: project the previous normal onto the plane
    // perpendicular to the current tangent.
    const tangent = tangents[i];
    normal = normal.clone().addScaledVector(tangent, -normal.dot(tangent));
    if (normal.lengthSq() < 1e-8) {
      normal = new THREE.Vector3().crossVectors(seed, tangent).normalize();
    } else {
      normal.normalize();
    }
    binormal.crossVectors(tangent, normal).normalize();

    const center = points[i];
    const radius = radiusAt(t);
    for (let j = 0; j <= radialSegments; j += 1) {
      const angle = (j / radialSegments) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const nx = normal.x * cos + binormal.x * sin;
      const ny = normal.y * cos + binormal.y * sin;
      const nz = normal.z * cos + binormal.z * sin;
      positions[p] = center.x + nx * radius;
      positions[p + 1] = center.y + ny * radius;
      positions[p + 2] = center.z + nz * radius;
      normals[p] = nx;
      normals[p + 1] = ny;
      normals[p + 2] = nz;
      p += 3;
      uvs[q] = j / radialSegments;
      uvs[q + 1] = t * 8;
      q += 2;
    }
  }

  for (let i = 0; i < segments; i += 1) {
    for (let j = 0; j < radialSegments; j += 1) {
      const a = i * ringVerts + j;
      const b = a + ringVerts;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

export class SwirlMesh {
  readonly group = new THREE.Group();
  private readonly material: THREE.MeshPhysicalMaterial;
  private tube: THREE.Mesh | null = null;
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
    return this.tube !== null;
  }

  /**
   * Rebuild the tube for the current height/lean. Caller is responsible for
   * throttling (~10x/sec while growing). Old geometry is disposed.
   */
  rebuild(height: number, lean: number, finished: boolean): void {
    const h = Math.max(0.06, height);
    const curve = new SwirlCurve(h, lean, finished);
    const segments = Math.min(MAX_SEGMENTS, Math.max(40, Math.round(h * 56)));
    const geometry = buildTubeGeometry(curve, segments, RADIAL_SEGMENTS, (t) =>
      tubeRadius(t, finished),
    );
    if (this.tube) {
      this.tube.geometry.dispose();
      this.tube.geometry = geometry;
    } else {
      this.tube = new THREE.Mesh(geometry, this.material);
      this.tube.castShadow = true;
      this.group.add(this.tube);
    }
    const tipPoint = curve.getPoint(1);
    this.tip.position.copy(tipPoint);
    this.tip.scale.setScalar(tubeRadius(1, finished) * 1.1);
    this.tip.visible = true;
  }

  /** Remove the swirl entirely (start of a new round). */
  reset(): void {
    if (this.tube) {
      this.tube.geometry.dispose();
      this.group.remove(this.tube);
      this.tube = null;
    }
    this.tip.visible = false;
    this.group.rotation.set(0, 0, 0);
  }

  dispose(): void {
    this.reset();
    this.tip.geometry.dispose();
    this.material.dispose();
  }
}
