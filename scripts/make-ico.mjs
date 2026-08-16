/**
 * PNG → 多尺寸 ICO（经典 BMP 位图格式，NSIS/资源工具兼容性最好）。
 * 用法：node scripts/make-ico.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = await loadImage(join(root, 'assets', 'app-icon.png'));

const sizes = [16, 24, 32, 48, 64, 128, 256];

/** 生成单个 ICO 位图数据块：BITMAPINFOHEADER + 自下而上 BGRA + AND 掩码 */
function dibEntry(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, size, size);
  const rgba = ctx.getImageData(0, 0, size, size).data;

  const headerSize = 40;
  const xorSize = size * size * 4;
  const andRowSize = Math.ceil(size / 32) * 4;
  const andSize = andRowSize * size;
  const buf = Buffer.alloc(headerSize + xorSize + andSize);

  buf.writeUInt32LE(headerSize, 0);   // biSize
  buf.writeInt32LE(size, 4);          // biWidth
  buf.writeInt32LE(size * 2, 8);      // biHeight = 2×（含 AND 掩码）
  buf.writeUInt16LE(1, 12);           // biPlanes
  buf.writeUInt16LE(32, 14);          // biBitCount
  // 其余字段（压缩/大小/分辨率/调色板）保持 0

  // 像素：自下而上、BGRA 序
  for (let y = 0; y < size; y++) {
    const srcRow = (size - 1 - y) * size * 4;
    const dstRow = headerSize + y * size * 4;
    for (let x = 0; x < size; x++) {
      const s = srcRow + x * 4;
      const d = dstRow + x * 4;
      buf[d] = rgba[s + 2];     // B
      buf[d + 1] = rgba[s + 1]; // G
      buf[d + 2] = rgba[s];     // R
      buf[d + 3] = rgba[s + 3]; // A
    }
  }
  // AND 掩码保持全 0（不透明信息由 alpha 通道表达）
  return buf;
}

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);

let offset = 6 + sizes.length * 16;
const entries = [];
const chunks = [];
for (const size of sizes) {
  const data = dibEntry(size);
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size >= 256 ? 0 : size, 0);
  entry.writeUInt8(size >= 256 ? 0 : size, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(data.length, 8);
  entry.writeUInt32LE(offset, 12);
  entries.push(entry);
  chunks.push(data);
  offset += data.length;
}

writeFileSync(join(root, 'assets', 'icon.ico'), Buffer.concat([header, ...entries, ...chunks]));
console.log('assets/icon.ico 已生成（BMP 格式，', sizes.join('/'), 'px）');
