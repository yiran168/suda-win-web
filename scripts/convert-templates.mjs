/**
 * 把安卓参考版 SourceTemplateManifest.kt 机械转换为 TS 数据模块。
 * 用法：node scripts/convert-templates.mjs
 * 输入：.reference/android-app/.../SourceTemplateManifest.kt
 * 输出：src/data/builtinTemplateSpecs.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(
  root, '..', '.reference', 'android-app', 'app', 'src', 'main', 'java',
  'com', 'qrint', 'studio', 'data', 'SourceTemplateManifest.kt',
);

const S = (id, title, category, widthMm, heightMm, decorResource, text, codes, shapes) =>
  ({ id, title, category, widthMm, heightMm, decorResource, text, codes, shapes });
const T = (text, left, top, right, bottom, emphasis, alignment) =>
  ({ text, left, top, right, bottom, emphasis, alignment });
const C = (type, left, top, right, bottom, content) =>
  ({ type, left, top, right, bottom, content });
const H = (kind, left, top, right, bottom, strokeWidth) =>
  ({ kind, left, top, right, bottom, strokeWidth });
const L = (...args) => args;

const source = readFileSync(manifestPath, 'utf8');
const lines = source.split('\n')
  .map((l) => l.trim())
  .filter((l) => l.startsWith('SourceTemplateSpec('));

const specs = [];
const failures = [];
for (const line of lines) {
  try {
    const js = line
      .replace(/SourceTemplateSpec\(/g, 'S(')
      .replace(/SourceTextSpec\(/g, 'T(')
      .replace(/SourceCodeSpec\(/g, 'C(')
      .replace(/SourceShapeSpec\(/g, 'H(')
      .replace(/emptyList\(\)/g, 'L()')
      .replace(/listOf\(/g, 'L(')
      .replace(/(\d(?:[\d_]*\d)?(?:\.\d+)?)f(?=[,\)])/g, '$1')
      .replace(/,\s*$/, '');
    // 数据为受控参考源码，逐行按表达式求值
    const spec = eval(`(${js})`);
    specs.push(spec);
  } catch (e) {
    failures.push(`${line.slice(0, 60)}… → ${String(e).slice(0, 80)}`);
  }
}

if (failures.length) {
  console.error(`失败 ${failures.length} 条：`);
  failures.slice(0, 5).forEach((f) => console.error(' ', f));
}

const out = `/**
 * 内置行业模板规格（494 套，自安卓参考版 SourceTemplateManifest 机械转换，请勿手改）。
 * 坐标均为 0..1 归一化，经 builtinTemplates.ts 映射为点阵文档。
 */
export interface BuiltinTextSpec { text: string; left: number; top: number; right: number; bottom: number; emphasis: boolean; alignment: string }
export interface BuiltinCodeSpec { type: string; left: number; top: number; right: number; bottom: number; content: string }
export interface BuiltinShapeSpec { kind: string; left: number; top: number; right: number; bottom: number; strokeWidth: number }
export interface BuiltinTemplateSpec {
  id: string; title: string; category: string;
  widthMm: number; heightMm: number; decorResource: string;
  text: BuiltinTextSpec[]; codes: BuiltinCodeSpec[]; shapes: BuiltinShapeSpec[];
}
const specs: BuiltinTemplateSpec[] = ${JSON.stringify(specs, null, 0)};
export default specs;
`;
writeFileSync(join(root, 'src', 'data', 'builtinTemplateSpecs.ts'), out);
console.log(`转换完成：${specs.length} 套模板 → src/data/builtinTemplateSpecs.ts`);
