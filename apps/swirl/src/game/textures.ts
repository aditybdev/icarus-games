/**
 * Procedurally generated canvas textures — no image assets.
 */
import * as THREE from 'three';

/** Waffle-cone crosshatch pattern drawn on a canvas. */
export function createWaffleTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  if (!g) {
    // Extremely unlikely, but degrade gracefully to a flat color texture.
    const fallback = new THREE.CanvasTexture(canvas);
    return fallback;
  }

  // Toasted base: vertical gradient from golden top to deeper baked bottom.
  const base = g.createLinearGradient(0, 0, 0, size);
  base.addColorStop(0, '#f2c186');
  base.addColorStop(0.55, '#e2a96a');
  base.addColorStop(1, '#cd8a4a');
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);

  // Baked speckle for slight value variation across the toast.
  for (let i = 0; i < 900; i += 1) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 0.6 + Math.random() * 1.8;
    g.fillStyle =
      Math.random() < 0.5
        ? `rgba(120, 70, 28, ${0.03 + Math.random() * 0.06})`
        : `rgba(255, 226, 180, ${0.03 + Math.random() * 0.06})`;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }

  const spacing = 84;
  const drawHatch = (angle: number, color: string, width: number) => {
    g.save();
    g.translate(size / 2, size / 2);
    g.rotate(angle);
    g.strokeStyle = color;
    g.lineWidth = width;
    g.lineCap = 'round';
    const span = size * 1.5;
    for (let x = -span; x <= span; x += spacing) {
      g.beginPath();
      g.moveTo(x, -span);
      g.lineTo(x, span);
      g.stroke();
    }
    g.restore();
  };

  // Crosshatch grooves with a soft highlight beside each groove.
  drawHatch(Math.PI / 4, '#f6cf96', 20);
  drawHatch(-Math.PI / 4, '#f6cf96', 20);
  drawHatch(Math.PI / 4, '#a86f34', 12);
  drawHatch(-Math.PI / 4, '#a86f34', 12);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 2);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Vertical pastel sky gradient for the backdrop plane. */
export function createSkyTexture(): THREE.CanvasTexture {
  const width = 64;
  const height = 512;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d');
  if (!g) return new THREE.CanvasTexture(canvas);

  // Canvas row 0 maps to the top of the backdrop plane.
  const grad = g.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, '#ffd3e1');
  grad.addColorStop(0.42, '#ffe4d8');
  grad.addColorStop(0.72, '#fff1e6');
  grad.addColorStop(1, '#fff1e6');
  g.fillStyle = grad;
  g.fillRect(0, 0, width, height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Soft puffy cloud sprite built from overlapping radial gradients. */
export function createCloudTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  if (!g) return new THREE.CanvasTexture(canvas);

  const puff = (cx: number, cy: number, r: number, alpha: number) => {
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
    grad.addColorStop(0.55, `rgba(255, 255, 255, ${alpha * 0.45})`);
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    g.fillStyle = grad;
    g.fillRect(cx - r, cy - r, r * 2, r * 2);
  };

  puff(128, 152, 92, 0.95);
  puff(82, 162, 62, 0.85);
  puff(176, 160, 66, 0.85);
  puff(108, 130, 58, 0.9);
  puff(152, 134, 60, 0.9);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Soft round additive glow (nozzle tip while dispensing). */
export function createGlowTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  if (!g) return new THREE.CanvasTexture(canvas);

  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
  grad.addColorStop(0.35, 'rgba(255, 244, 220, 0.45)');
  grad.addColorStop(1, 'rgba(255, 244, 220, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Dark radial blob used as a fake contact shadow under the cone. */
export function createBlobShadowTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  if (!g) return new THREE.CanvasTexture(canvas);

  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(88, 48, 26, 0.42)');
  grad.addColorStop(0.55, 'rgba(88, 48, 26, 0.2)');
  grad.addColorStop(1, 'rgba(88, 48, 26, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Tiny equirectangular pastel environment for PMREM — gives physical
 * materials (sheen/clearcoat/metal) something soft to reflect.
 */
export function createEnvironmentTexture(): THREE.CanvasTexture {
  const width = 64;
  const height = 32;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d');
  if (!g) return new THREE.CanvasTexture(canvas);

  // Equirect: canvas top = zenith (bright sky), bottom = warm ground bounce.
  const grad = g.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, '#fffaf2');
  grad.addColorStop(0.45, '#ffe9ee');
  grad.addColorStop(0.62, '#fff1e6');
  grad.addColorStop(1, '#dfa878');
  g.fillStyle = grad;
  g.fillRect(0, 0, width, height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
