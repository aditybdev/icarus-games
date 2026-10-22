/**
 * The soft-serve dispenser hovering at the top of the scene.
 * Fully procedural: a support column, a pastel machine head and a nozzle,
 * plus a small lamp that shows the currently selected flavor.
 */
import * as THREE from 'three';

/** World position of the nozzle tip — the extrusion origin. */
export const NOZZLE_TIP = new THREE.Vector3(0, 7.12, 0);

export interface Dispenser {
  group: THREE.Group;
  /** Call each frame for a gentle idle bob. */
  update(time: number): void;
  /** Tint the flavor lamp. */
  setLampColor(hex: number): void;
}

export function createDispenser(): Dispenser {
  const group = new THREE.Group();

  const pinkMat = new THREE.MeshStandardMaterial({ color: 0xffc7d9, roughness: 0.5 });
  const creamMat = new THREE.MeshStandardMaterial({ color: 0xfff6ec, roughness: 0.4 });
  const chromeMat = new THREE.MeshStandardMaterial({
    color: 0xfdfdfd,
    roughness: 0.25,
    metalness: 0.35,
  });

  // Support column behind the play area.
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 5.4, 16), pinkMat);
  column.position.set(0, 5.2, -1.7);
  column.castShadow = true;
  group.add(column);

  // Machine head, cantilevered forward so the nozzle sits over x = 0.
  const head = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.1, 1.9), pinkMat);
  body.castShadow = true;
  head.add(body);

  const face = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.7, 0.08), creamMat);
  face.position.set(0, 0.08, 0.98);
  head.add(face);

  // Pull handle on the front.
  const handleArm = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.5, 10), chromeMat);
  handleArm.rotation.x = Math.PI / 5;
  handleArm.position.set(-0.35, -0.1, 1.05);
  head.add(handleArm);
  const handleGrip = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10), chromeMat);
  handleGrip.position.set(-0.35, -0.32, 1.16);
  head.add(handleGrip);

  // Flavor lamp.
  const lampMat = new THREE.MeshStandardMaterial({
    color: 0xfff3dd,
    emissive: 0xfff3dd,
    emissiveIntensity: 0.6,
    roughness: 0.3,
  });
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 12), lampMat);
  lamp.position.set(0.45, 0.12, 1.0);
  head.add(lamp);

  head.position.set(0, 7.85, -0.85);
  group.add(head);

  // Nozzle under the head, centered over the cone track. Polished steel:
  // higher metalness picks up the scene environment for a premium shine.
  const nozzleMat = new THREE.MeshStandardMaterial({
    color: 0xf2f4f6,
    roughness: 0.22,
    metalness: 0.7,
  });
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 0.5, 16), nozzleMat);
  nozzle.position.set(0, NOZZLE_TIP.y + 0.24, 0);
  nozzle.castShadow = true;
  group.add(nozzle);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.05, 10, 18), pinkMat);
  collar.rotation.x = Math.PI / 2;
  collar.position.set(0, NOZZLE_TIP.y + 0.42, 0);
  group.add(collar);

  const baseY = head.position.y;
  return {
    group,
    update(time: number): void {
      head.position.y = baseY + Math.sin(time * 1.3) * 0.03;
      nozzle.position.y = NOZZLE_TIP.y + 0.24 + Math.sin(time * 1.3) * 0.03;
    },
    setLampColor(hex: number): void {
      lampMat.color.setHex(hex);
      lampMat.emissive.setHex(hex);
    },
  };
}
