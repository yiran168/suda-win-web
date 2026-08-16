/** bwip-js 浏览器构建的最小类型声明（包内 d.ts 指向 node 构建，浏览器用 toCanvas）。 */
declare module 'bwip-js' {
  export interface ToCanvasOptions {
    bcid: string;
    text: string;
    scale?: number;
    width?: number;
    height?: number;
    includetext?: boolean;
    textxalign?: 'left' | 'center' | 'right';
    [key: string]: unknown;
  }
  export function toCanvas(canvas: HTMLCanvasElement, options: ToCanvasOptions): HTMLCanvasElement;
}
