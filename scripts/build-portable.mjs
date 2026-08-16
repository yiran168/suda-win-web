/**
 * 手动便携版打包（无需 electron-builder / 无需管理员权限 / 完全离线）：
 * 1. 复制 Electron 运行时 → release/qrint-portable
 * 2. electron.exe 重命名为 素打.exe
 * 3. resources/app 放入 dist + electron 主进程 + assets + 生产依赖（serialport 链）
 * 4. 打成 zip
 *
 * 用法：npm run build 之后执行  node scripts/build-portable.mjs
 */
import { cpSync, copyFileSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'release', 'qrint-portable');

if (!existsSync(join(root, 'dist', 'index.html'))) {
  console.error('请先运行 npm run build');
  process.exit(1);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

console.log('1/5 复制 Electron 运行时…');
cpSync(join(root, 'node_modules', 'electron', 'dist'), outDir, { recursive: true });

console.log('2/5 重命名主程序…');
renameSync(join(outDir, 'electron.exe'), join(outDir, '素打.exe'));

console.log('3/5 组装 resources/app…');
const appDir = join(outDir, 'resources', 'app');
mkdirSync(appDir, { recursive: true });
cpSync(join(root, 'dist'), join(appDir, 'dist'), { recursive: true });
cpSync(join(root, 'electron'), join(appDir, 'electron'), { recursive: true });
cpSync(join(root, 'assets'), join(appDir, 'assets'), { recursive: true });

// 精简 package.json（主进程只需要 main 字段与依赖声明）
writeFileSync(join(appDir, 'package.json'), JSON.stringify({
  name: 'qrint-studio', version: '1.0.0', main: 'electron/main.cjs', private: true,
}, null, 2));

console.log('4/5 复制串口原生依赖（serialport N-API 预编译）…');
const prodModules = ['serialport', '@serialport', 'node-addon-api', 'node-gyp-build', 'debug', 'ms'];
for (const mod of prodModules) {
  const from = join(root, 'node_modules', mod);
  if (existsSync(from)) cpSync(from, join(appDir, 'node_modules', mod), { recursive: true });
}

console.log('5/5 打 zip 包…');
const zipPath = join(root, 'release', '素打-便携版.zip');
rmSync(zipPath, { force: true });
// 用系统 PowerShell 压缩（Git Bash 的 GNU tar 不支持 -a 生成 zip）
execFileSync(
  'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  ['-NoProfile', '-Command', `Compress-Archive -Path '${outDir}\\*' -DestinationPath '${zipPath}' -Force`],
  { stdio: 'inherit' },
);

console.log('\n完成：');
console.log('  便携目录:', outDir);
console.log('  压缩包  :', zipPath);
console.log('  运行    : qrint-portable\\素打.exe');
