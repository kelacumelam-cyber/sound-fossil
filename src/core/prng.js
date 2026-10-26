/**
 * Deterministic randomness and noise helpers.
 * Same seed + same settings = same result.
 */

export function fnv1a(text, seed = 0x811c9dc5) {
  let hash = seed >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function hashBytes(bytes, seed = 0x811c9dc5) {
  let hash = seed >>> 0;
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function hashFloat32(samples, stride = 1) {
  let hash = 0x811c9dc5;
  const step = Math.max(1, Math.floor(stride));
  for (let i = 0; i < samples.length; i += step) {
    const value = Math.round(samples[i] * 8388607) | 0;
    hash ^= value & 0xff;
    hash = Math.imul(hash, 0x01000193);
    hash ^= (value >>> 8) & 0xff;
    hash = Math.imul(hash, 0x01000193);
    hash ^= (value >>> 16) & 0xff;
    hash = Math.imul(hash, 0x01000193);
    hash ^= (value >>> 24) & 0xff;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function hashGeometryData(positions, colors, indices, seed = 0x811c9dc5) {
  let hash = seed >>> 0;
  const view = new DataView(positions.buffer, positions.byteOffset, positions.byteLength);
  for (let i = 0; i < view.byteLength; i += 4) {
    hash ^= view.getUint32(i, true);
    hash = Math.imul(hash, 0x01000193);
  }
  const colorView = new DataView(colors.buffer, colors.byteOffset, colors.byteLength);
  for (let i = 0; i < colorView.byteLength; i += 4) {
    hash ^= colorView.getUint32(i, true);
    hash = Math.imul(hash, 0x01000193);
  }
  for (let i = 0; i < indices.length; i += 1) {
    hash ^= indices[i];
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function toHex(value, width = 4) {
  return (value >>> 0).toString(16).toUpperCase().padStart(width, '0').slice(-width);
}

export function mulberry32(seed) {
  let state = seed >>> 0;
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

/**
 * Seamless 2D value noise around a ring.
 * When circular coordinates are used as input, θ=0/2π stays continuous.
 */
export function createNoise2D(seed) {
  const random = mulberry32(seed);
  const perm = new Uint8Array(512);
  const values = new Float32Array(256);
  const base = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [base[i], base[j]] = [base[j], base[i]];
  }
  for (let i = 0; i < 512; i += 1) perm[i] = base[i & 255];
  for (let i = 0; i < 256; i += 1) values[i] = random();

  const valueAt = (ix, iy) => values[perm[(ix & 255) + perm[iy & 255]]];

  return function noise(x, y) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = smoothstep(x - x0);
    const ty = smoothstep(y - y0);
    const v00 = valueAt(x0, y0);
    const v10 = valueAt(x0 + 1, y0);
    const v01 = valueAt(x0, y0 + 1);
    const v11 = valueAt(x0 + 1, y0 + 1);
    const a = v00 + (v10 - v00) * tx;
    const b = v01 + (v11 - v01) * tx;
    return a + (b - a) * ty;
  };
}
