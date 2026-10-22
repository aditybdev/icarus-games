/**
 * The waffle cone: procedural cone geometry + generated crosshatch texture.
 */
import * as THREE from 'three';
import { createWaffleTexture } from './textures';

/** World-space height of the cone's opening rim. */
export const CONE_TOP_Y = 1.52;
/** Height where the swirl tube begins (slightly inside the opening). */
export const SWIRL_BASE_Y = 1.32;

const CONE_RADIUS = 0.62;
const CONE_HEIGHT = 1.5;

export function createCone(): THREE.Group {
  const group = new THREE.Group();
  const waffle = createWaffleTexture();

  // Outer shell: ConeGeometry has its apex at +Y, so flip it tip-down.
  const outerMat = new THREE.MeshStandardMaterial({
    map: waffle,
    roughness: 0.75,
    metalness: 0,
  });
  const outer = new THREE.Mesh(
    new THREE.ConeGeometry(CONE_RADIUS, CONE_HEIGHT, 28, 1, true),
    outerMat,
  );
  outer.rotation.x = Math.PI;
  outer.position.y = CONE_TOP_Y - CONE_HEIGHT / 2;
  outer.castShadow = true;
  group.add(outer);

  // Rim torus around the opening.
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xd99e56, roughness: 0.7 });
  const rim = new THREE.Mesh(new THREE.TorusGeometry(CONE_RADIUS, 0.05, 10, 28), rimMat);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = CONE_TOP_Y;
  rim.castShadow = true;
  group.add(rim);

  // Dark interior disk so you can't see through the shell.
  const innerMat = new THREE.MeshStandardMaterial({ color: 0x8a5a2e, roughness: 0.9 });
  const inner = new THREE.Mesh(new THREE.CircleGeometry(CONE_RADIUS * 0.9, 24), innerMat);
  inner.rotation.x = -Math.PI / 2;
  inner.position.y = SWIRL_BASE_Y - 0.06;
  group.add(inner);

  return group;
}
