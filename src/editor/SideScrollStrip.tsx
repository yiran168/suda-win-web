/**
 * 画布滚动长条（竖条 + 横条共用一套逻辑，DRY）：
 * - 手指/鼠标在长条上滑动，画布内容同步滚动（竖条映射 scrollTop，横条映射 scrollLeft）
 * - 滑块大小/位置实时反映视口与内容比例（含画布缩放 zoom 引起的内容宽度变化）
 * - 长条是画布的「兄弟节点」而非覆盖层：不压画布、不占纸面
 * - 竖条随画布收起/展开同步伸缩；横条只在内容超宽（画布放大）时可操作
 */
import { useEffect, useRef, useState, RefObject } from 'react';

interface StripProps {
  /** 画布滚动容器 */
  targetRef: RefObject<HTMLElement | null>;
  /** 竖条：画布是否收起（收起时隐藏滑块） */
  collapsed?: boolean;
  orientation: 'vertical' | 'horizontal';
}

export function ScrollStrip({ targetRef, collapsed = false, orientation }: StripProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState({ ratio: 1, offset: 0 });
  const draggingRef = useRef(false);
  const vertical = orientation === 'vertical';

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;
    const update = () => {
      const total = vertical ? target.scrollHeight : target.scrollWidth;
      const view = vertical ? target.clientHeight : target.clientWidth;
      const ratio = total <= 0 ? 1 : Math.min(1, view / total);
      const maxScroll = Math.max(1, total - view);
      setMetrics({ ratio, offset: (vertical ? target.scrollTop : target.scrollLeft) / maxScroll });
    };
    update();
    target.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(target);
    if (target.firstElementChild) ro.observe(target.firstElementChild); // 内容尺寸（zoom/高度变化）也要刷新滑块
    return () => {
      target.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, [targetRef, collapsed, vertical]);

  const scrollToRatio = (clientPos: number) => {
    const track = trackRef.current;
    const target = targetRef.current;
    if (!track || !target) return;
    const rect = track.getBoundingClientRect();
    const t = vertical
      ? Math.min(1, Math.max(0, (clientPos - rect.top) / rect.height))
      : Math.min(1, Math.max(0, (clientPos - rect.left) / rect.width));
    if (vertical) target.scrollTop = t * Math.max(0, target.scrollHeight - target.clientHeight);
    else target.scrollLeft = t * Math.max(0, target.scrollWidth - target.clientWidth);
  };

  const onPointerDown = (ev: React.PointerEvent) => {
    (ev.target as Element).setPointerCapture(ev.pointerId);
    draggingRef.current = true;
    scrollToRatio(vertical ? ev.clientY : ev.clientX);
  };
  const onPointerMove = (ev: React.PointerEvent) => {
    if (draggingRef.current) scrollToRatio(vertical ? ev.clientY : ev.clientX);
  };
  const onPointerUp = () => { draggingRef.current = false; };

  const thumbPct = Math.max(12, metrics.ratio * 100);
  const thumbOffset = `${metrics.offset * (100 - thumbPct)}%`;
  // 横条：内容不超宽时没有可滚动空间，滑块占满且不可拖动（保留占位避免布局跳动）
  const idle = metrics.ratio >= 0.999;

  return (
    <div
      ref={trackRef}
      className={`scroll-strip ${vertical ? 'scroll-strip-v' : 'scroll-strip-h'}${collapsed ? ' collapsed' : ''}${idle ? ' idle' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      role="scrollbar"
      aria-orientation={orientation}
      aria-label={vertical ? '画布纵向滚动条' : '画布横向滚动条'}
      title={vertical ? '上下拖动画布' : '左右拖动画布（画布放大后可用）'}
    >
      {!collapsed && (
        <div
          className="scroll-strip-thumb"
          style={vertical ? { height: `${thumbPct}%`, top: thumbOffset } : { width: `${thumbPct}%`, left: thumbOffset }}
        />
      )}
    </div>
  );
}

/** 竖条：画布右侧，上下滚动 */
export function SideScrollStrip({ targetRef, collapsed }: { targetRef: RefObject<HTMLElement | null>; collapsed: boolean }) {
  return <ScrollStrip targetRef={targetRef} collapsed={collapsed} orientation="vertical" />;
}

/** 横条：画布正下方，左右滚动（画布放大后内容超宽时使用） */
export function BottomScrollStrip({ targetRef }: { targetRef: RefObject<HTMLElement | null> }) {
  return <ScrollStrip targetRef={targetRef} orientation="horizontal" />;
}
