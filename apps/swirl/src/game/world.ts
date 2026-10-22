/**
 * Scene assembly: renderer, pastel backdrop, lighting + soft shadows,
 * camera framing for any aspect ratio, ground, decorations, dispenser,
 * cone + swirl, and the dispense strand.
 */
import * as THREE from 'three';
import { CONE_RANGE } from '../core/constants';
import { createCone, SWIRL_BASE_Y } from './cone';
import { createDispenser, NOZZLE_TIP, type Dispenser } from './dispenser';
import { SwirlMesh } from './swirlMesh';

const BG_COLOR = 0xfff1e6;
const CAMERA_FOV = 42;

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly coneGroup = new THREE.Group();
  readonly swirl = new SwirlMesh();
  readonly dispenser: Dispenser;
  readonly strand: THREE.Mesh;

  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly strandUp = new THREE.Vector3(0, 1, 0);
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(BG_COLOR);
    this.scene.fog = new THREE.Fog(BG_COLOR, 20, 46);

    this.camera = new THREE.PerspectiveCamera(
      CAMERA_FOV,
      window.innerWidth / window.innerHeight,
      0.1,
      100,
    );

    // Lighting: soft hemisphere fill + one shadow-casting key light.
    const hemi = new THREE.HemisphereLight(0xfff8ef, 0xffd9e4, 0.95);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1.7);
    sun.position.set(4.5, 11, 6.5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -7;
    sun.shadow.camera.right = 7;
    sun.shadow.camera.top = 12;
    sun.shadow.camera.bottom = -2;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 32;
    sun.shadow.bias = -0.0004;
    this.scene.add(sun);
    sun.target.position.set(0, 2.5, 0);
    this.scene.add(sun.target);

    // Ground.
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(48, 48),
      new THREE.MeshStandardMaterial({ color: 0xffe6d4, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Pastel scoops half-buried in the background for depth.
    const decoData: Array<[number, number, number, number, number]> = [
      [-6.5, -0.6, -9, 2.0, 0xffd3e0],
      [5.8, -0.9, -10.5, 2.4, 0xc8f2dd],
      [0.5, -1.2, -13, 3.0, 0xfff0d9],
      [-3.4, -1.1, -12, 1.6, 0xd9e6ff],
      [8.6, -0.5, -8, 1.3, 0xffe3b8],
    ];
    for (const [x, y, z, r, color] of decoData) {
      const scoop = new THREE.Mesh(
        new THREE.SphereGeometry(r, 24, 18),
        new THREE.MeshStandardMaterial({ color, roughness: 0.9 }),
      );
      scoop.position.set(x, y, z);
      this.scene.add(scoop);
    }

    // Dispenser + cone + swirl.
    this.dispenser = createDispenser();
    this.scene.add(this.dispenser.group);

    this.coneGroup.add(createCone());
    this.swirl.group.position.set(0, SWIRL_BASE_Y, 0);
    this.coneGroup.add(this.swirl.group);
    this.scene.add(this.coneGroup);

    // Strand of flowing ice cream between nozzle and swirl tip.
    this.strand = new THREE.Mesh(
      new THREE.CylinderGeometry(0.085, 0.105, 1, 10, 1, true),
      this.swirl.swirlMaterial,
    );
    this.strand.visible = false;
    this.scene.add(this.strand);

    this.frameCamera();
  }

  /** Aim the camera so the full play area fits any aspect ratio. */
  frameCamera(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const aspect = w / h;
    this.camera.aspect = aspect;
    // Vertical half-extent needed at z=0: enough for the nozzle on short
    // screens, enough width for the cone track on narrow portrait screens.
    const vHalf = Math.max(4.9, 3.6 / aspect);
    const dist = vHalf / Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV / 2));
    this.camera.position.set(0, 4.6, dist + 1.2);
    this.camera.lookAt(0, 3.9, 0);
    this.camera.updateProjectionMatrix();
  }

  resize(): void {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.frameCamera();
  }

  /** Map a client pointer position to a world X on the ground plane. */
  pointerToWorldX(clientX: number, clientY: number): number | null {
    this.ndc.set(
      (clientX / window.innerWidth) * 2 - 1,
      -(clientY / window.innerHeight) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const { origin, direction } = this.raycaster.ray;
    if (Math.abs(direction.y) < 1e-6) return null;
    const t = -origin.y / direction.y;
    if (!Number.isFinite(t) || t <= 0) return null;
    const x = origin.x + direction.x * t;
    return THREE.MathUtils.clamp(x, -CONE_RANGE, CONE_RANGE);
  }

  setConeX(x: number): void {
    this.coneGroup.position.x = THREE.MathUtils.clamp(x, -CONE_RANGE, CONE_RANGE);
  }

  get coneX(): number {
    return this.coneGroup.position.x;
  }

  /** Show/hide and stretch the dispense strand between nozzle and tip. */
  updateStrand(visible: boolean): void {
    if (!visible || !this.swirl.visibleHeight) {
      this.strand.visible = false;
      return;
    }
    this.swirl.group.updateWorldMatrix(true, false);
    this.tmpA.copy(this.swirl.tipPosition).applyMatrix4(this.swirl.group.matrixWorld);
    this.tmpB.copy(NOZZLE_TIP).sub(this.tmpA);
    const length = this.tmpB.length();
    if (length < 0.05) {
      this.strand.visible = false;
      return;
    }
    this.strand.visible = true;
    this.strand.position.copy(this.tmpA).addScaledVector(this.tmpB, 0.5);
    this.strand.quaternion.setFromUnitVectors(this.strandUp, this.tmpB.normalize());
    this.strand.scale.set(1, length, 1);
  }

  render(time: number): void {
    this.dispenser.update(time);
    this.renderer.render(this.scene, this.camera);
  }
}
