/**
 * 图片缓存：元素 src（dataURL）→ HTMLImageElement，加载完成后触发回调重绘。
 * preload：打印/批量渲染前的预热——异步加载赶不上当次渲染时会画出空白页，
 * 预热把所有图片等到位（成功或失败都返回，单张超时兜底，绝不卡死打印）。
 */
export class ImageCache {
  private map = new Map<string, HTMLImageElement | 'loading'>();
  private listeners = new Set<() => void>();

  get(src: string): HTMLImageElement | null {
    if (!src) return null;
    const hit = this.map.get(src);
    if (hit === 'loading') return null;
    if (hit) return hit;
    this.map.set(src, 'loading');
    const img = new Image();
    img.onload = () => {
      this.map.set(src, img);
      this.listeners.forEach((fn) => fn());
    };
    // 失败同样要通知：一是界面能重绘兜底，二是 preload 的等待能解开
    img.onerror = () => {
      this.map.delete(src);
      this.listeners.forEach((fn) => fn());
    };
    img.src = src;
    return null;
  }

  /** 等所有 src 加载结束（成功或失败）；已在缓存的直接跳过。 */
  async preload(srcs: string[], timeoutMs = 15000): Promise<void> {
    const uniq = Array.from(new Set(srcs.filter(Boolean)));
    await Promise.all(uniq.map((src) => new Promise<void>((resolve) => {
      const hit = this.map.get(src);
      if (hit && hit !== 'loading') { resolve(); return; }
      const off = this.subscribe(() => {
        // 'loading' 之外的状态（成功 = 图片对象 / 失败 = 已删除）都结束等待
        if (this.map.get(src) !== 'loading') { clearTimeout(timer); off(); resolve(); }
      });
      const timer = setTimeout(() => { off(); resolve(); }, timeoutMs);
      this.get(src); // 触发或复用进行中的加载
    })));
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export const sharedImageCache = new ImageCache();
