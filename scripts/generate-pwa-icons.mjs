/**
 * Generate the Bienen Doku PWA icons without an external rasterizer.
 * The installable Web App Manifest needs real 192px and 512px PNG assets.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";

const glyphs = {
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
};

const crcTable = Array.from({ length: 256 }, (_, input) => {
  let value = input;
  for (let bit = 0; bit < 8; bit++) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  return value >>> 0;
});

function chunk(name, payload) {
  const type = Buffer.from(name);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(payload.length);
  const raw = Buffer.concat([type, payload]);
  let crc = 0xffffffff;
  for (const byte of raw) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  const end = Buffer.alloc(4);
  end.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([len, raw, end]);
}

function inHex(x, y, radius) {
  const width = radius * Math.sqrt(3) / 2;
  return Math.abs(x) <= width && Math.abs(y) <= radius - Math.abs(x) / Math.sqrt(3);
}

function icon(size) {
  const rows = Buffer.alloc(size * (size * 4 + 1));
  const center = size / 2;
  const scale = Math.max(2, Math.round(size * 0.035));
  const glyphWidth = 11 * scale;
  const textX = Math.round(center - glyphWidth / 2);
  const textY = Math.round(center - (7 * scale) / 2);
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    rows[row] = 0;
    for (let x = 0; x < size; x++) {
      const cx = x + .5 - center, cy = y + .5 - center;
      // Full-bleed deep green is safe for Android adaptive/maskable icons.
      let color = [39, 95, 69];
      if (inHex(cx, cy, size * .40)) color = [226, 166, 43];
      if (inHex(cx, cy, size * .326)) color = [39, 95, 69];
      const col = Math.floor((x - textX) / scale);
      const line = Math.floor((y - textY) / scale);
      if (line >= 0 && line < 7 && col >= 0 && col < 11) {
        const character = col < 5 ? glyphs.B : col >= 6 ? glyphs.D : null;
        const letterX = col < 5 ? col : col - 6;
        if (character && character[line][letterX] === "1") color = [255, 249, 231];
      }
      const offset = row + 1 + x * 4;
      rows[offset] = color[0]; rows[offset + 1] = color[1];
      rows[offset + 2] = color[2]; rows[offset + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // RGBA PNG
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rows, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

await mkdir("public/icons", { recursive: true });
await Promise.all([
  writeFile("public/icons/icon-192.png", icon(192)),
  writeFile("public/icons/icon-512.png", icon(512)),
  writeFile("public/icons/apple-touch-icon.png", icon(180)),
]);
