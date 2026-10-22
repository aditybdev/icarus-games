/**
 * Procedurally generated canvas textures — no image assets.
 */
import * as THREE from 'three';

/** Waffle-cone crosshatch pattern drawn on a canvas. */
export function createWaffleTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  if (!g) {
    // Extremely unlikely, but degrade gracefully to a flat color texture.
    const fallback = new THREE.CanvasTexture(canvas);
    return fallback;
  }

  g.fillStyle = '#e2a96a';
  g.fillRect(0, 0, size, size);

  const spacing = 42;
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
  drawHatch(Math.PI / 4, '#f3c98d', 10);
  drawHatch(-Math.PI / 4, '#f3c98d', 10);
  drawHatch(Math.PI / 4, '#b57a3a', 6);
  drawHatch(-Math.PI / 4, '#b57a3a', 6);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 2);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
