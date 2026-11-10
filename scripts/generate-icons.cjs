const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Minimal PNG writer using built-in zlib
function createPng(width, height, getPixel) {
  const rowSize = width * 4 + 1;
  const rawData = Buffer.alloc(rowSize * height);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    rawData[rowOffset] = 0; // Filter type 0 (None)
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = getPixel(x, y, width, height);
      const pxOffset = rowOffset + 1 + x * 4;
      rawData[pxOffset] = r;
      rawData[pxOffset + 1] = g;
      rawData[pxOffset + 2] = b;
      rawData[pxOffset + 3] = a;
    }
  }

  const deflated = zlib.deflateSync(rawData);

  // CRC32 calculation table
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      if (c & 1) c = 0xedb88320 ^ (c >>> 1);
      else c = c >>> 1;
    }
    crcTable[n] = c;
  }

  function crc32(buf) {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function createChunk(type, data) {
    const len = data.length;
    const buf = Buffer.alloc(12 + len);
    buf.writeUInt32BE(len, 0);
    buf.write(type, 4, 4, 'ascii');
    data.copy(buf, 8);
    const typeAndData = buf.subarray(4, 8 + len);
    const crc = crc32(typeAndData);
    buf.writeUInt32BE(crc, 8 + len);
    return buf;
  }

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const header = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrChunk = createChunk('IHDR', ihdr);
  const idatChunk = createChunk('IDAT', deflated);
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([header, ihdrChunk, idatChunk, iendChunk]);
}

function renderAppIcon(x, y, w, h, isMaskable = false) {
  // Center coordinates normalized -1 to 1
  const nx = (x / w) * 2 - 1;
  const ny = (y / h) * 2 - 1;
  const rDist = Math.sqrt(nx * nx + ny * ny);

  // Background gradient: dark slate to deep indigo
  const bgGrad = (ny + 1) * 0.5;
  const bgR = Math.round(15 * (1 - bgGrad) + 9 * bgGrad);
  const bgG = Math.round(23 * (1 - bgGrad) + 13 * bgGrad);
  const bgB = Math.round(42 * (1 - bgGrad) + 26 * bgGrad);

  // Corner bounds / safe zone for maskable
  const scale = isMaskable ? 0.72 : 0.85;
  const sx = nx / scale;
  const sy = ny / scale;

  // Camera corner brackets check
  const inBracketCorner =
    (Math.abs(sx) > 0.6 && Math.abs(sx) < 0.85 && Math.abs(sy) > 0.6 && Math.abs(sy) < 0.85);

  const isBracketLine =
    (Math.abs(sx) >= 0.75 && Math.abs(sx) <= 0.85 && Math.abs(sy) >= 0.45 && Math.abs(sy) <= 0.85) ||
    (Math.abs(sy) >= 0.75 && Math.abs(sy) <= 0.85 && Math.abs(sx) >= 0.45 && Math.abs(sx) <= 0.85);

  // Target highlight bounding box in center
  const inHighlightBox = Math.abs(sx) < 0.55 && Math.abs(sy) < 0.25;
  const onHighlightBorder = inHighlightBox && (
    Math.abs(sx) > 0.51 || Math.abs(sy) > 0.21
  );

  // Text bars inside highlight box
  const inTargetText1 = Math.abs(sy) < 0.08 && sx > -0.42 && sx < -0.05;
  const inTargetText2 = Math.abs(sy) < 0.08 && sx > 0.05 && sx < 0.38;

  // Top/bottom secondary text lines
  const inSubText1 = Math.abs(sy + 0.45) < 0.04 && Math.abs(sx) < 0.5;
  const inSubText2 = Math.abs(sy - 0.45) < 0.04 && Math.abs(sx) < 0.45;

  // Laser beam across middle
  const inLaser = Math.abs(sy) < 0.015 && Math.abs(sx) < 0.7;

  if (inLaser) {
    return [0, 242, 254, 255]; // Cyan laser
  }
  if (inTargetText1 || inTargetText2) {
    return [52, 211, 153, 255]; // Emerald text
  }
  if (onHighlightBorder) {
    return [16, 185, 129, 255]; // Neon green border
  }
  if (inHighlightBox) {
    return [
      Math.round(bgR * 0.7 + 16 * 0.3),
      Math.round(bgG * 0.7 + 185 * 0.3),
      Math.round(bgB * 0.7 + 129 * 0.3),
      255
    ];
  }
  if (isBracketLine) {
    return [56, 189, 248, 255]; // Sky blue bracket
  }
  if (inSubText1 || inSubText2) {
    return [100, 116, 139, 200];
  }

  // Soft center cyan glow
  const glow = Math.max(0, 1 - rDist * 1.4);
  const finalR = Math.min(255, Math.round(bgR + glow * 10));
  const finalG = Math.min(255, Math.round(bgG + glow * 50));
  const finalB = Math.min(255, Math.round(bgB + glow * 80));

  return [finalR, finalG, finalB, 255];
}

const publicDir = path.resolve(__dirname, '../public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

console.log('Generating PWA icons...');
const icon192 = createPng(192, 192, (x, y, w, h) => renderAppIcon(x, y, w, h, false));
fs.writeFileSync(path.join(publicDir, 'pwa-192x192.png'), icon192);

const icon512 = createPng(512, 512, (x, y, w, h) => renderAppIcon(x, y, w, h, false));
fs.writeFileSync(path.join(publicDir, 'pwa-512x512.png'), icon512);

const iconMaskable = createPng(512, 512, (x, y, w, h) => renderAppIcon(x, y, w, h, true));
fs.writeFileSync(path.join(publicDir, 'pwa-maskable-512x512.png'), iconMaskable);

const appleIcon = createPng(180, 180, (x, y, w, h) => renderAppIcon(x, y, w, h, false));
fs.writeFileSync(path.join(publicDir, 'apple-touch-icon.png'), appleIcon);

// Also generate a small favicon
const favicon = createPng(64, 64, (x, y, w, h) => renderAppIcon(x, y, w, h, false));
fs.writeFileSync(path.join(publicDir, 'favicon.ico'), favicon);

console.log('Successfully generated all PWA icons in /public!');
