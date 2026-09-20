'use strict';

// Generates build/icon.ico to match site/favicon.svg exactly.
//
// The mark is drawn once at a high-resolution master (768px), then every ICO
// size is produced by area-average (box) downscaling so each size stays crisp
// and identical to the others. 768 is an exact multiple of every target size,
// so the downscale is a clean integer block average with no fringing.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// favicon.svg is authored on a 64x64 viewBox. Scale everything by K.
const VIEW = 64;
const MASTER = 768;
const K = MASTER / VIEW; // 12
const px = new Uint8Array(MASTER * MASTER * 4);

function put(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= MASTER || y >= MASTER) return;
  const i = (y * MASTER + x) * 4;
  const na = a / 255;
  const oa = px[i + 3] / 255;
  const outA = na + oa * (1 - na);
  if (outA <= 0) return;
  px[i] = Math.round((r * na + px[i] * oa * (1 - na)) / outA);
  px[i + 1] = Math.round((g * na + px[i + 1] * oa * (1 - na)) / outA);
  px[i + 2] = Math.round((b * na + px[i + 2] * oa * (1 - na)) / outA);
  px[i + 3] = Math.round(outA * 255);
}

// Signed distance to a rounded rectangle (cx,cy = center, half = half-size,
// radius = corner radius), all in master pixels.
function roundedRectMask(x, y, cx, cy, half, radius) {
  const dx = Math.abs(x - cx) - (half - radius);
  const dy = Math.abs(y - cy) - (half - radius);
  const ox = Math.max(dx, 0), oy = Math.max(dy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(dx, dy), 0) - radius;
}

function circle(cx, cy, rad, r, g, b, a = 255) {
  for (let y = Math.floor(cy - rad - 2); y <= cy + rad + 2; y++) {
    for (let x = Math.floor(cx - rad - 2); x <= cx + rad + 2; x++) {
      const d = Math.hypot(x - cx, y - cy) - rad;
      if (d < 1) put(x, y, r, g, b, a * Math.min(1, 1 - d));
    }
  }
}

function ring(cx, cy, rad, width, r, g, b, a = 255) {
  for (let y = Math.floor(cy - rad - width); y <= cy + rad + width; y++) {
    for (let x = Math.floor(cx - rad - width); x <= cx + rad + width; x++) {
      const d = Math.abs(Math.hypot(x - cx, y - cy) - rad) - width / 2;
      if (d < 1) put(x, y, r, g, b, a * Math.min(1, 1 - d));
    }
  }
}

// Round-capped line, matching stroke-linecap="round" in the favicon.
function line(x0, y0, x1, y1, width, r, g, b, a = 255) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  for (let t = 0; t <= len; t += 0.5) {
    const x = x0 + ((x1 - x0) * t) / len;
    const y = y0 + ((y1 - y0) * t) / len;
    circle(x, y, width / 2, r, g, b, a);
  }
}

// --- Draw the favicon mark, scaled from the 64px viewBox to the master. ---

// rect x=2 y=2 w=60 h=60 rx=15, gradient #7c5cff -> #4a9eff (top-left to
// bottom-right across the rect).
const RX = 2 * K, RY = 2 * K, RW = 60 * K, RH = 60 * K;
const rcx = RX + RW / 2, rcy = RY + RH / 2;
const rHalf = RW / 2, rRad = 15 * K;
for (let y = 0; y < MASTER; y++) {
  for (let x = 0; x < MASTER; x++) {
    const d = roundedRectMask(x, y, rcx, rcy, rHalf, rRad);
    if (d < 1) {
      // SVG objectBoundingBox gradient along the (0,0)->(1,1) diagonal.
      const u = (x - RX) / RW, v = (y - RY) / RH;
      const t = Math.min(1, Math.max(0, (u + v) / 2));
      const r = Math.round(0x7c + (0x4a - 0x7c) * t);
      const g = Math.round(0x5c + (0x9e - 0x5c) * t);
      const b = Math.round(0xff + (0xff - 0xff) * t);
      put(x, y, r, g, b, 255 * Math.min(1, 1 - d));
    }
  }
}

// clock ring: circle cx32 cy34 r15 stroke #fff 3.5
ring(32 * K, 34 * K, 15 * K, 3.5 * K, 255, 255, 255);
// hands: M32 34 V24  and  l7 4.5  (stroke #fff 3.5, round caps)
line(32 * K, 34 * K, 32 * K, 24 * K, 3.5 * K, 255, 255, 255);
line(32 * K, 34 * K, 39 * K, 38.5 * K, 3.5 * K, 255, 255, 255);
// record dot: circle cx49 cy15 r5.5 fill #ff4d5e stroke #fff 1.8
circle(49 * K, 15 * K, 5.5 * K, 255, 77, 94);
ring(49 * K, 15 * K, 5.5 * K, 1.8 * K, 255, 255, 255);

// --- PNG / ICO plumbing ---

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// Area-average downscale with premultiplied alpha (srcSize must be an exact
// multiple of dstSize, which holds for every target here).
function downscale(src, srcSize, dstSize) {
  const f = srcSize / dstSize;
  const out = new Uint8Array(dstSize * dstSize * 4);
  for (let y = 0; y < dstSize; y++) {
    for (let x = 0; x < dstSize; x++) {
      let sr = 0, sg = 0, sb = 0, sa = 0;
      for (let by = 0; by < f; by++) {
        for (let bx = 0; bx < f; bx++) {
          const si = (((y * f + by) * srcSize) + (x * f + bx)) * 4;
          const a = src[si + 3] / 255;
          sr += src[si] * a;
          sg += src[si + 1] * a;
          sb += src[si + 2] * a;
          sa += a;
        }
      }
      const di = (y * dstSize + x) * 4;
      const outA = sa / (f * f);
      if (sa > 0) {
        out[di] = Math.round(sr / sa);
        out[di + 1] = Math.round(sg / sa);
        out[di + 2] = Math.round(sb / sa);
      }
      out[di + 3] = Math.round(outA * 255);
    }
  }
  return out;
}

function pngFromPixels(pixels, size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(pixels.buffer, pixels.byteOffset + y * size * 4, size * 4)
      .copy(raw, y * (size * 4 + 1) + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function buildIco(sizes) {
  const pngs = sizes.map((size) => pngFromPixels(downscale(px, MASTER, size), size));

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);

  let offset = 6 + sizes.length * 16;
  const entries = [];
  const images = [];

  for (let i = 0; i < sizes.length; i++) {
    const size = sizes[i];
    const png = pngs[i];
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    images.push(png);
    offset += png.length;
  }

  return Buffer.concat([header, ...entries, ...images]);
}

const sizes = [16, 24, 32, 48, 64, 128, 256];
const ico = buildIco(sizes);
const outDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'icon.ico');
fs.writeFileSync(outPath, ico);
console.log(`Wrote ${outPath} (${ico.length} bytes, ${sizes.length} sizes)`);
