/**
 * 主题系统：每套主题是一组 CSS 变量。
 * 设置页所有入口（关于素打 / 使用方法 / 运行日志）都只引用变量，
 * 因此显示天然跟随主题切换。
 */

export interface ThemeDef {
  id: string;
  name: string;
  description: string;
  vars: Record<string, string>;
}

const base = {
  '--radius-s': '8px',
  '--radius-m': '14px',
  '--radius-l': '20px',
  '--font-ui': 'system-ui, "PingFang SC", "Microsoft YaHei", sans-serif',
  '--font-display': 'system-ui, "PingFang SC", "Microsoft YaHei", sans-serif',
};

export const THEMES: ThemeDef[] = [
  {
    id: 'mist', name: '晨雾 · 浅色', description: '默认浅色，纸张感背景',
    vars: { ...base,
      '--bg': '#f5f4f0', '--bg-soft': '#eceae4', '--surface': '#ffffff',
      '--surface-2': '#f7f6f2', '--text': '#24231f', '--text-2': '#6f6c64',
      '--line': 'rgba(36,35,31,0.12)', '--primary': '#3d5a46', '--on-primary': '#ffffff',
      '--primary-soft': '#e3ece6', '--danger': '#b4443c', '--shadow': '0 8px 28px rgba(36,35,31,0.10)',
      '--canvas-blank': '#e7e5de' },
  },
  {
    id: 'ink', name: '墨夜 · 深色', description: '深色低蓝光，夜间校对',
    vars: { ...base,
      '--bg': '#17181b', '--bg-soft': '#101114', '--surface': '#212228',
      '--surface-2': '#2a2b32', '--text': '#eceae4', '--text-2': '#9b98a0',
      '--line': 'rgba(236,234,228,0.14)', '--primary': '#8fc1a1', '--on-primary': '#10231a',
      '--primary-soft': '#2c3a33', '--danger': '#e08a80', '--shadow': '0 10px 30px rgba(0,0,0,0.45)',
      '--canvas-blank': '#0d0e10' },
  },
  {
    id: 'frost', name: '冰晶 · 磨砂', description: '冷色磨砂玻璃质感',
    vars: { ...base,
      '--bg': '#e8eef4', '--bg-soft': '#dde6ee', '--surface': 'rgba(255,255,255,0.72)',
      '--surface-2': 'rgba(255,255,255,0.55)', '--text': '#1d2733', '--text-2': '#5b6b7a',
      '--line': 'rgba(29,39,51,0.14)', '--primary': '#2f6f9f', '--on-primary': '#ffffff',
      '--primary-soft': '#d9e8f2', '--danger': '#b4443c', '--shadow': '0 10px 32px rgba(47,111,159,0.18)',
      '--canvas-blank': '#d3dde6' },
  },
  {
    id: 'flow', name: '流体 · 暖橙', description: '暖色流体渐变氛围',
    vars: { ...base,
      '--bg': '#faf1e8', '--bg-soft': '#f3e6d8', '--surface': '#fffaf3',
      '--surface-2': '#f8efe3', '--text': '#33261c', '--text-2': '#857364',
      '--line': 'rgba(51,38,28,0.12)', '--primary': '#c2562f', '--on-primary': '#fff8f2',
      '--primary-soft': '#f6dfd2', '--danger': '#a83a32', '--shadow': '0 10px 30px rgba(194,86,47,0.16)',
      '--canvas-blank': '#efe2d1' },
  },
  {
    id: 'smoke', name: '烟熏 · 灰调', description: '中性灰，专注内容',
    vars: { ...base,
      '--bg': '#e9e9ea', '--bg-soft': '#dedee0', '--surface': '#f4f4f5',
      '--surface-2': '#ececed', '--text': '#26262a', '--text-2': '#71717a',
      '--line': 'rgba(38,38,42,0.14)', '--primary': '#4b4b55', '--on-primary': '#f4f4f5',
      '--primary-soft': '#e0e0e4', '--danger': '#a63d40', '--shadow': '0 8px 26px rgba(38,38,42,0.14)',
      '--canvas-blank': '#d8d8db' },
  },
  {
    id: 'prism', name: '棱镜 · 黛紫', description: '黛紫渐变，玻璃层级',
    vars: { ...base,
      '--bg': '#efeaf6', '--bg-soft': '#e4dcf0', '--surface': 'rgba(252,250,255,0.8)',
      '--surface-2': 'rgba(246,241,252,0.7)', '--text': '#2a2233', '--text-2': '#6f6480',
      '--line': 'rgba(42,34,51,0.12)', '--primary': '#6a4d9e', '--on-primary': '#f8f5ff',
      '--primary-soft': '#e6ddf3', '--danger': '#b4443c', '--shadow': '0 10px 30px rgba(106,77,158,0.18)',
      '--canvas-blank': '#ddd3ea' },
  },
];

export function applyTheme(id: string): void {
  const theme = THEMES.find((t) => t.id === id) ?? THEMES[0];
  const root = document.documentElement;
  for (const [k, v] of Object.entries(theme.vars)) root.style.setProperty(k, v);
  root.dataset.theme = theme.id;
}

export function currentThemeId(): string {
  return document.documentElement.dataset.theme || THEMES[0].id;
}
