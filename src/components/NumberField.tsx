/**
 * 数字输入框：允许彻底清空再输入。
 * 聚焦时进入草稿态（原样显示键入内容，包括空串 / 负号 / 小数点），
 * 输入合法数字时实时提交；失焦或回车时若为空 / 非法则回退到当前值。
 */
import { useState } from 'react';
import { clamp } from '../model/document';

interface Props {
  value: number;
  onCommit: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
  /** 显示小数位（默认原样） */
  digits?: number;
}

function fmt(v: number, digits?: number): string {
  if (digits !== undefined) return v.toFixed(digits);
  return String(Math.round(v * 100) / 100);
}

export function NumberField({ value, onCommit, min = -Infinity, max = Infinity, step, className, digits }: Props) {
  const [draft, setDraft] = useState<string | null>(null);

  const commit = (raw: string) => {
    const v = Number(raw);
    if (raw.trim() !== '' && Number.isFinite(v)) onCommit(clamp(v, min, max));
  };

  return (
    <input
      type="number"
      className={className}
      step={step}
      value={draft ?? fmt(value, digits)}
      onFocus={() => setDraft(fmt(value, digits))}
      onChange={(e) => {
        setDraft(e.target.value);
        if (e.target.value.trim() !== '') commit(e.target.value);
      }}
      onBlur={(e) => {
        commit(e.target.value); // 空 / 非法：commit 内部会忽略，草稿清空后自动回显当前值
        setDraft(null);
      }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
    />
  );
}
