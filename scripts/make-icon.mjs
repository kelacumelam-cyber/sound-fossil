import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'assets');
await mkdir(outDir, { recursive: true });

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

const AMBER = [0.86, 0.61, 0.32];
const BONE = [0.94, 0.86, 0.71];
const VERDIGRIS = [0.34, 0.55, 0.49];
const DARK = [0.07, 0.06, 0.05];

function sample(x, y) {
  const px = (x + 0.5) / 256;
  const py = (y + 0.5) / 256;
  const dx = (px * 2 - 1) * 1.02;
  const dy = (py * 2 - 1) * 1.02;

  // Rounded-square SDF.
  const radius = 0.4;
  const qx = Math.abs(dx) - (1 - radius);
  const qy = Math.abs(dy) - (1 - radius);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
  if (outside > 0) return [0, 0, 0, 0];

  const edge = smoothstep(-0.035, 0, outside);
  const r = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);

  // Base: dark stone.
  let color = mix([0.115, 0.094, 0.074], [0.032, 0.027, 0.023], smoothstep(-0.9, 0.9, dy));

  // Outer frame.
  const border = smoothstep(-0.026, -0.004, outside) * (1 - smoothstep(-0.004, 0.002, outside));
  color = mix(color, [0.36, 0.27, 0.18], border * 0.8);

  // Center glow.
  const glow = Math.exp(-(r * r) / 0.075) * 0.5;
  color = mix(color, [0.28, 0.19, 0.1], glow);

  // Wavy concentric sediment rings.
  const warp = r + 0.036 * Math.sin(angle * 3 + r * 8.5) + 0.014 * Math.sin(angle * 5 - r * 15);
  const phase = warp * 51 + 1.2 * Math.sin(angle * 2);
  const band = Math.sin(phase);
  const line = smoothstep(0.78, 1, band) * smoothstep(0.99, 0.94, r);
  const lineColor = mix(AMBER, VERDIGRIS, smoothstep(0.25, 0.82, r));
  color = mix(color, lineColor, line * 0.86);

  const fine = smoothstep(0.965, 1, Math.sin(phase * 2.7)) * smoothstep(0.86, 0.98, r);
  color = mix(color, BONE, fine * 0.18);

  // Spiral shell line.
  const spiral = Math.sin(angle * 2 + r * 17.5);
  const spiralLine = smoothstep(0.11, 0.015, Math.abs(spiral)) * smoothstep(0.9, 0.2, r);
  color = mix(color, [0.2, 0.31, 0.28], spiralLine * 0.28);

  // Center medallion.
  const medallion = smoothstep(0.2, 0.17, r);
  color = mix(color, [0.045, 0.038, 0.03], medallion * 0.9);
  const ring = smoothstep(0.018, 0.004, Math.abs(r - 0.177)) * 0.9;
  color = mix(color, AMBER, ring);
  const core = smoothstep(0.075, 0.03, r);
  color = mix(color, BONE, core * 0.55);
  const coreHot = Math.exp(-(r * r) / 0.0022) * 0.55;
  color = mix(color, [1, 0.85, 0.62], coreHot);

  // Fine stone grain.
  const grain = Math.sin(dx * 91 + dy * 37) * Math.sin(dy * 63 - dx * 19);
  color = color.map((value) => Math.min(1, Math.max(0, value + grain * 0.012)));

  const alpha = 255 * (1 - edge);
  return [color[0] * 255, color[1] * 255, color[2] * 255, alpha];
}

function renderSize(size) {
  const scale = 4;
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < scale; sy += 1) {
        for (let sx = 0; sx < scale; sx += 1) {
          const sampleX = ((x + (sx + 0.5) / scale) / size) * 256 - 0.5;
          const sampleY = ((y + (sy + 0.5) / scale) / size) * 256 - 0.5;
          const [cr, cg, cb, ca] = sample(sampleX, sampleY);
          r += cr;
          g += cg;
          b += cb;
          a += ca;
        }
      }
      const count = scale * scale;
      const offset = (y * size + x) * 4;
      rgba[offset] = Math.round(r / count);
      rgba[offset + 1] = Math.round(g / count);
      rgba[offset + 2] = Math.round(b / count);
      rgba[offset + 3] = Math.round(a / count);
    }
  }
  return rgba;
}

function makeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = [];
  for (const image of images) {
    const entry = Buffer.alloc(16);
    entry[0] = image.size >= 256 ? 0 : image.size;
    entry[1] = image.size >= 256 ? 0 : image.size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(image.png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += image.png.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)]);
}

const sizes = [16, 32, 48, 64, 128, 256];
const images = sizes.map((size) => {
  const rgba = renderSize(size);
  return { size, rgba, png: encodePng(size, size, rgba) };
});

const ico = makeIco(images);
await writeFile(path.join(outDir, 'icon.ico'), ico);

const previewSize = 512;
const preview = encodePng(previewSize, previewSize, renderSize(previewSize));
await writeFile(path.join(outDir, 'icon.png'), preview);

console.log(`Icon generated: assets/icon.ico (${sizes.join(', ')} px) and assets/icon.png`);
