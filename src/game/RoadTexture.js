import * as THREE from 'three';

let cached = null;

/**
 * A small tileable asphalt texture (speckled surface + a dashed center lane
 * line) generated on a canvas — no external image files, matching the
 * project's "no external art assets" approach. Callers should `.clone()`
 * the result and set `.repeat` per mesh so tiling density matches that
 * mesh's real-world size instead of stretching to fit each box's UVs.
 */
export function createAsphaltTexture() {
  if (cached) return cached;

  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#3c3c40';
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 500; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const v = 34 + Math.random() * 46;
    ctx.fillStyle = `rgba(${v},${v},${v + 4},0.55)`;
    ctx.fillRect(x, y, 1.4, 1.4);
  }

  ctx.fillStyle = '#e8d97a';
  const dashLen = size * 0.3;
  const dashWidth = size * 0.04;
  ctx.fillRect(0, size / 2 - dashWidth / 2, dashLen, dashWidth);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  cached = texture;
  return texture;
}

/**
 * Scales a BoxGeometry's UVs so the single shared asphalt texture tiles at
 * roughly `tileSize` world units, without allocating a per-mesh texture.
 *
 * Previously every road segment got its own `texture.clone()` with
 * `needsUpdate = true` forced, so every one of the ~100+ segments on a
 * figure-eight track (built synchronously inside the "Start Race" click
 * handler) triggered its own full GPU texture upload of identical pixel
 * data — a real contributor to that handler blocking the main thread long
 * enough to show up as a slow-interaction (INP) warning. Scaling UVs
 * instead reuses one texture for the whole track. This applies the same
 * repeat uniformly to all 6 box faces (as `texture.repeat` did before too),
 * so side-face tiling on these thin road slabs is an approximation exactly
 * like it was previously — no visual regression, just no redundant uploads.
 */
export function applyRoadUV(geometry, length, width, tileSize = 6) {
  const repeatX = Math.max(1, length / tileSize);
  const repeatY = Math.max(1, width / tileSize);
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * repeatX, uv.getY(i) * repeatY);
  }
  uv.needsUpdate = true;
}
