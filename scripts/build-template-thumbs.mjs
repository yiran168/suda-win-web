/**
 * 内置模板缩略图：用「原始设计图」（含文字的完整效果）做模板库卡片预览。
 * - 文档本身仍由「净化底图 + 可编辑文字/条码/图形叠加层」组成，内容全部可改；
 *   缩略图只是预览，不进文档。
 * 输入：.reference/android-app/template-source/source_catalog_quality.json（id → 原图文件名）
 *       .reference/templates-src/（模板原图，png/jpg）
 * 输出：public/templates/thumb/<id>.<ext>  +  src/data/templateThumbs.ts（id → 路径）
 * 用法：node scripts/build-template-thumbs.mjs
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const catalogPath = join(root, '..', '.reference', 'android-app', 'template-source', 'source_catalog_quality.json');
const srcDir = join(root, '..', '.reference', 'templates-src');
const outDir = join(root, 'public', 'templates', 'thumb');

const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
const details = catalog.details;

if (existsSync(outDir)) rmSync(outDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

const map = {};
let copied = 0;
const missing = [];
for (const d of details) {
  const src = join(srcDir, d.source);
  if (!existsSync(src)) { missing.push(d.source); continue; }
  const ext = extname(d.source).toLowerCase(); // .png / .jpg
  const name = `${d.id}${ext}`;
  copyFileSync(src, join(outDir, name));
  map[d.id] = `./templates/thumb/${name}`;
  copied++;
}

const out = `/**
 * 内置模板缩略图映射（自 source_catalog_quality.json 生成，请勿手改）。
 * 缩略图 = 模板原始设计图（含文字的最终效果预览）；模板文档内容依然全部可编辑。
 */
export const TEMPLATE_THUMBS: Record<string, string> = ${JSON.stringify(map, null, 0)};
`;
writeFileSync(join(root, 'src', 'data', 'templateThumbs.ts'), out);
console.log(`缩略图完成：${copied} 张 → public/templates/thumb/，缺失 ${missing.length} 张`);
if (missing.length) console.log('缺失样例：', missing.slice(0, 5));
