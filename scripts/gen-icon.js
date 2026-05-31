'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const S = 256;
const px = new Uint8Array(S * S * 4);

function put(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= S || y >= S) return;
  const i = (y * S + x) * 4;
  const na = a / 255;
  const oa = px[i + 3] / 255;
  const outA = na + oa * (1 - na);
  if (outA <= 0) return;
  px[i] = Math.round((r * na + px[i] * oa * (1 - na)) / outA);
  px[i + 1] = Math.round((g * na + px[i + 1] * oa * (1 - na)) / outA);
  px[i + 2] = Math.round((b * na + px[i + 2] * oa * (1 - na)) / outA);
  px[i + 3] = Math.round(outA * 255);
}

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

function line(x0, y0, x1, y1, width, r, g, b, a = 255) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  for (let t = 0; t <= len; t += 0.5) {
    const x = x0 + ((x1 - x0) * t) / len;
    const y = y0 + ((y1 - y0) * t) / len;
    circle(x, y, width / 2, r, g, b, a);
  }
}

const C = S / 2, HALF = 118, RAD = 56;
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const d = roundedRectMask(x, y, C, C, HALF, RAD);
    if (d < 1) {
      const t = (x + y) / (2 * S);
      const r = Math.round(124 + (74 - 124) * t);
      const g = Math.round(92 + (158 - 92) * t);
      const b = 255;
      put(x, y, r, g, b, 255 * Math.min(1, 1 - d));
    }
  }
}

ring(C, C, 62, 12, 255, 255, 255);
line(C, C, C, C - 40, 11, 255, 255, 255);
line(C, C, C + 30, C + 18, 11, 255, 255, 255);
circle(C, C, 9, 255, 255, 255);
circle(C + 74, C - 74, 20, 255, 77, 94);
ring(C + 74, C - 74, 20, 5, 255, 255, 255);

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

const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0;
  Buffer.from(px.buffer, y * S * 4, S * 4).copy(raw, y * (S * 4 + 1) + 1);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
]);

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);

const entry = Buffer.alloc(16);
entry[0] = 0;
entry[1] = 0;
entry[4] = 1;
entry[6] = 32;
entry.writeUInt32LE(png.length, 8);
entry.writeUInt32LE(22, 12);

const outDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'icon.ico'), Buffer.concat([header, entry, png]));
console.log(`Wrote ${path.join(outDir, 'icon.ico')} (${png.length + 22} bytes)`);
