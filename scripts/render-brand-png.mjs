import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let i = 0; i < 8; i += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(width, height, pixel) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = pixel(x, y);
      const i = row + 1 + x * 4;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const orange = [249, 115, 22, 255];
const white = [255, 255, 255, 255];
const ink = [28, 25, 23, 255];

function logo(x, y) {
  const cx = 64;
  const cy = 64;
  const dx = x - cx;
  const dy = y - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist > 52) return white;
  if (dist > 40) return orange;
  // A simple S so the mark is recognizable as a logo, not a photograph.
  const inS = (x > 46 && x < 82 && y > 34 && y < 48)
    || (x > 46 && x < 60 && y > 48 && y < 62)
    || (x > 46 && x < 82 && y > 62 && y < 76)
    || (x > 68 && x < 82 && y > 76 && y < 90)
    || (x > 46 && x < 82 && y > 90 && y < 104);
  return inS ? white : orange;
}

function box(x, y) {
  if (y < 28 || y > 108 || x < 24 || x > 104) return white;
  if (y < 48) return orange;
  if (y < 54) return white;
  if (x > 58 && x < 70) return ink;
  return [255, 247, 237, 255];
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../apps/api/public/media/brands/sanctum');
fs.mkdirSync(root, { recursive: true });
fs.writeFileSync(path.join(root, 'logo.png'), png(128, 128, logo));
fs.writeFileSync(path.join(root, 'box.png'), png(128, 128, box));
console.log(`wrote ${root}`);
