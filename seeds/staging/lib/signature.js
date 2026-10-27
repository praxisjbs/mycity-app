"use strict";
/**
 * A drawn signature for the staging seeds, as the signature pad sends it: a PNG data URL of a
 * dark stroke on a transparent 240 x 80 box. Built here, with no image library, so a seeded query
 * or sanction prints a mark on its letter the way a signed one does. Each name gives its own stroke.
 */
const zlib = require("node:zlib");

const W = 240;
const H = 80;

/** The PNG chunk CRC (ISO 3309). */
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/**
 * The signature of `name` as a PNG data URL.
 * @param {string} name
 */
function signatureOf(name) {
  const seed = [...String(name)].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) % 997, 7);
  const rgba = Buffer.alloc(W * H * 4);
  const dot = (x, y) => {
    for (let dx = -1; dx <= 1; dx += 1)
      for (let dy = -1; dy <= 1; dy += 1) {
        const px = Math.round(x) + dx;
        const py = Math.round(y) + dy;
        if (px < 0 || py < 0 || px >= W || py >= H) continue;
        const i = (py * W + px) * 4;
        rgba[i] = 0x1f;
        rgba[i + 1] = 0x2a;
        rgba[i + 2] = 0x44;
        rgba[i + 3] = 0xff;
      }
  };
  const a = 2 + (seed % 3);
  const b = 5 + (seed % 4);
  for (let t = 0; t <= 1; t += 0.0008) {
    const x = 16 + t * (W - 32);
    const y = H / 2 + Math.sin(t * Math.PI * a) * 18 + Math.sin(t * Math.PI * b) * 7 - t * 6;
    dot(x, y);
  }
  // The underline.
  for (let x = 40; x < W - 30; x += 0.5) dot(x, H - 14 + Math.sin(x / 40) * 2);

  const raw = Buffer.alloc(H * (W * 4 + 1));
  for (let y = 0; y < H; y += 1) {
    raw[y * (W * 4 + 1)] = 0;
    rgba.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString("base64")}`;
}

module.exports = { signatureOf };
