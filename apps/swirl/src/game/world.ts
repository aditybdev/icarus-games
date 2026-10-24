/**
 * Scene assembly: renderer, pastel backdrop, lighting + soft shadows,
 * camera framing for any aspect ratio, ground, decorations, dispenser,
 * cone + swirl, and the dispense strand.
 */
import * as THREE from 'three';
import { CONE_RANGE } from '../core/constants';
import { createCone, SWIRL_BASE_Y } from './cone';
import { createDispenser, NOZZLE_TIP, type Dispenser } from './dispenser';
import { Motes } from './motes';
import { Sprinkles } from './sprinkles';
import { SwirlMesh } from './swirlMesh';
import {
  createBlobShadowTexture,
  createCloudTexture,
  createEnvironmentTexture,
  createGlowTexture,
  createSkyTexture,
} from './textures';

const BG_COLOR = 0xfff1e6;
const CAMERA_FOV = 42;

interface Cloud {
  sprite: THREE.Sprite;
  baseX: number;
  baseY: number;
  amp: number;
  speed: number;
  phase: number;
  /** Signed fraction of cone X applied as background parallax. */
  parallax: number;
}

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly coneGroup = new THREE.Group();
  readonly swirl = new SwirlMesh();
  readonly dispenser: Dispenser;
  readonly strand: THREE.Mesh;
  readonly sprinkles = new Sprinkles();

  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly strandUp = new THREE.Vector3(0, 1, 0);
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private readonly camBase = new THREE.Vector3();
  /** Background scoops; shifted slightly against cone X for parallax. */
  private readonly decoGroup = new THREE.Group();
  private readonly clouds: Cloud[] = [];
  private readonly motes = new Motes();
  /** Additive glow sprite hugging the nozzle tip while dispensing. */
  private readonly glow: THREE.Sprite;
  private readonly glowMaterial: THREE.SpriteMaterial;
  private shakeAmp = 0;
  /** Perfect-serve camera orbit progress in [0, 1]; negative = inactive. */
  private spectacleT = -1;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(BG_COLOR);
    this.scene.fog = new THREE.Fog(BG_COLOR, 20, 46);

    // Soft pastel environment so physical materials (swirl sheen/clearcoat,
    // steel nozzle) have something gentle to reflect. One-time PMREM bake.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envSource = createEnvironmentTexture();
    this.scene.environment = pmrem.fromEquirectangular(envSource).texture;
    this.scene.environmentIntensity = 0.45;
    envSource.dispose();
    pmrem.dispose();

    // Gradient sky: a huge fog-exempt plane far behind the play field.
    const sky = new THREE.Mesh(
      new THREE.PlaneGeometry(120, 44),
      new THREE.MeshBasicMaterial({
        map: createSkyTexture(),
        fog: false,
        depthWrite: false,
      }),
    );
    sky.position.set(0, 12, -34);
    this.scene.add(sky);

    this.camera = new THREE.PerspectiveCamera(
      CAMERA_FOV,
      window.innerWidth / window.innerHeight,
      0.1,
      100,
    );

    // Lighting: soft hemisphere fill + one shadow-casting key light,
    // plus a warm rim/back light that edges the swirl against the sky.
    const hemi = new THREE.HemisphereLight(0xfff8ef, 0xffd9e4, 0.9);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1.45);
    sun.position.set(4.5, 11, 6.5);
    sun.castShadow = true;
    // 1024 is ample for a 14-unit shadow camera (~73 texels/world-unit) and
    // quarters the per-frame shadow-pass fill cost vs 2048 — the shadow map
    // re-renders every frame because the cone/swirl move continuously.
    sun.shadow.mapSize.set(1024, 1024);
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

    // Warm rim light from behind-left: creamy edge highlights, no shadows.
    const rim = new THREE.DirectionalLight(0xffdfc2, 1.1);
    rim.position.set(-6.5, 8, -7);
    rim.target.position.set(0, 3.2, 0);
    this.scene.add(rim);
    this.scene.add(rim.target);

    // Ground.
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(48, 48),
      new THREE.MeshStandardMaterial({ color: 0xffe6d4, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Pastel scoops half-buried in the background for depth. Grouped so
    // they can drift a few percent against cone movement (parallax).
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
      this.decoGroup.add(scoop);
    }
    this.scene.add(this.decoGroup);

    // Slow-drifting pastel clouds, hazed by fog for aerial perspective.
    const cloudTexture = createCloudTexture();
    const cloudData: Array<[number, number, number, number, number, number, number, number]> = [
      // x, y, z, width, height, opacity, speed, phase
      [-7.5, 8.5, -16, 7, 3.0, 0.6, 0.08, 0.0],
      [6.5, 10.5, -18, 8.5, 3.4, 0.5, 0.06, 2.1],
      [0.5, 12.5, -21, 10, 4.0, 0.42, 0.05, 4.4],
    ];
    for (const [x, y, z, w, h, opacity, speed, phase] of cloudData) {
      const material = new THREE.SpriteMaterial({
        map: cloudTexture,
        transparent: true,
        opacity,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(material);
      sprite.scale.set(w, h, 1);
      sprite.position.set(x, y, z);
      this.scene.add(sprite);
      this.clouds.push({
        sprite,
        baseX: x,
        baseY: y,
        amp: 0.9 + w * 0.06,
        speed,
        phase,
        parallax: -0.03,
      });
    }

    // Dispenser + cone + swirl.
    this.dispenser = createDispenser();
    this.scene.add(this.dispenser.group);

    this.coneGroup.add(createCone());

    // Soft contact blob shadow under the cone so it grounds visually.
    const blob = new THREE.Mesh(
      new THREE.PlaneGeometry(2.1, 2.1),
      new THREE.MeshBasicMaterial({
        map: createBlobShadowTexture(),
        transparent: true,
        depthWrite: false,
      }),
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.02;
    this.coneGroup.add(blob);
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

    // Additive glow at the nozzle tip, shown while dispensing.
    this.glowMaterial = new THREE.SpriteMaterial({
      map: createGlowTexture(),
      color: 0xfff6e4,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.glow = new THREE.Sprite(this.glowMaterial);
    this.glow.position.set(NOZZLE_TIP.x, NOZZLE_TIP.y - 0.06, NOZZLE_TIP.z);
    this.glow.scale.setScalar(0.62);
    this.glow.visible = false;
    this.scene.add(this.glow);

    this.scene.add(this.sprinkles.points);
    this.scene.add(this.motes.points);

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
    this.camBase.copy(this.camera.position);
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
      this.glow.visible = false;
      return;
    }
    this.swirl.group.updateWorldMatrix(true, false);
    this.tmpA.copy(this.swirl.tipPosition).applyMatrix4(this.swirl.group.matrixWorld);
    this.tmpB.copy(NOZZLE_TIP).sub(this.tmpA);
    const length = this.tmpB.length();
    if (length < 0.05) {
      this.strand.visible = false;
      this.glow.visible = false;
      return;
    }
    this.strand.visible = true;
    this.strand.position.copy(this.tmpA).addScaledVector(this.tmpB, 0.5);
    this.strand.quaternion.setFromUnitVectors(this.strandUp, this.tmpB.normalize());
    this.strand.scale.set(1, length, 1);
    // Nozzle glow, tinted to match the flowing flavor.
    this.glowMaterial.color.copy(this.swirl.swirlMaterial.color);
    this.glow.visible = true;
  }

  /**
   * Camera micro-shake amplitude in world units (0 = perfectly still).
   * Applied as a tiny positional jitter around the framing position.
   */
  setShake(amp: number): void {
    this.shakeAmp = amp > 0 ? amp : 0;
  }

  /** Perfect-serve camera orbit progress [0, 1], or null to restore framing. */
  setSpectacle(t: number | null): void {
    this.spectacleT = t === null ? -1 : Math.min(1, Math.max(0, t));
  }

  /** World position of the swirl tip (for burst origins). */
  swirlTipWorld(target: THREE.Vector3): THREE.Vector3 {
    this.swirl.group.updateWorldMatrix(true, false);
    return target.copy(this.swirl.tipPosition).applyMatrix4(this.swirl.group.matrixWorld);
  }

  render(time: number, dt = 0): void {
    this.dispenser.update(time);
    this.sprinkles.update(dt);
    this.motes.update(time);
    // Gentle parallax: background layers counter-drift a few percent of
    // cone X. Camera position stays owned by the shake/spectacle logic.
    const coneX = this.coneGroup.position.x;
    this.decoGroup.position.x = coneX * -0.06;
    for (const cloud of this.clouds) {
      cloud.sprite.position.x =
        cloud.baseX + Math.sin(time * cloud.speed + cloud.phase) * cloud.amp +
        coneX * cloud.parallax;
      cloud.sprite.position.y =
        cloud.baseY + Math.sin(time * cloud.speed * 0.7 + cloud.phase * 1.7) * 0.3;
    }
    if (this.glow.visible) {
      this.glow.scale.setScalar(0.62 + Math.sin(time * 9) * 0.05);
    }
    if (this.spectacleT >= 0) {
      // Gentle orbit + dolly around the look-at point over the slow-mo beat.
      const t = this.spectacleT;
      const ang = t * 0.55;
      const dolly = 1 - 0.12 * Math.sin(Math.PI * t);
      const dy = this.camBase.y - 3.9;
      const cos = Math.cos(ang);
      const sin = Math.sin(ang);
      this.camera.position.set(
        (this.camBase.x * cos - this.camBase.z * sin) * dolly,
        3.9 + dy * dolly,
        (this.camBase.x * sin + this.camBase.z * cos) * dolly,
      );
      this.camera.lookAt(0, 3.9, 0);
    } else {
      this.camera.position.copy(this.camBase);
    }
    if (this.shakeAmp > 0.0001) {
      const a = this.shakeAmp;
      this.camera.position.x += Math.sin(time * 53.7) * a;
      this.camera.position.y += Math.sin(time * 47.3) * a * 0.7;
      this.camera.position.z += Math.sin(time * 61.1) * a * 0.4;
    }
    this.renderer.render(this.scene, this.camera);
  }
}
