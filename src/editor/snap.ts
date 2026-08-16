/**
 * 磁吸对齐：带滞后的轻量吸附，移植自安卓参考版 MagneticSnapController。
 * 小幅移动可以精确停到参考线上；持续拖动会积累位移直到"挣脱"，
 * 用户不需要快速甩动来逃离纸边或中心线。
 */

export interface AxisSnapResult {
  /** 应叠加到本次位移上的修正量（点） */
  correction: number;
  /** 吸附中的参考线位置（点），未吸附为 null */
  guide: number | null;
}

interface SnapLock {
  sourceIndex: number;
  target: number;
  escape: number;
}

export class AxisSnap {
  private lock: SnapLock | null = null;

  constructor(
    private captureDistanceDots = 2,
    private releaseDistanceDots = 6,
  ) {}

  reset(): void { this.lock = null; }

  apply(sources: number[], targets: number[], pointerMovement: number): AxisSnapResult {
    if (!sources.length || !targets.length) {
      this.reset();
      return { correction: 0, guide: null };
    }
    const cur = this.lock;
    if (cur) {
      if (cur.sourceIndex >= sources.length) {
        this.reset();
      } else {
        cur.escape += pointerMovement;
        if (Math.abs(cur.escape) >= this.releaseDistanceDots) {
          const catchUp = cur.escape - pointerMovement;
          this.reset();
          return { correction: catchUp, guide: null };
        }
        return { correction: cur.target - sources[cur.sourceIndex], guide: cur.target };
      }
    }
    let best: { sourceIndex: number; correction: number; target: number } | null = null;
    sources.forEach((source, sourceIndex) => {
      for (const target of targets) {
        const correction = target - source;
        if (Math.abs(correction) <= this.captureDistanceDots
          && (best === null || Math.abs(correction) < Math.abs(best.correction))) {
          best = { sourceIndex, correction, target };
        }
      }
    });
    if (best === null) return { correction: 0, guide: null };
    const match: { sourceIndex: number; correction: number; target: number } = best;
    this.lock = { sourceIndex: match.sourceIndex, target: match.target, escape: 0 };
    return { correction: match.correction, guide: match.target };
  }
}
