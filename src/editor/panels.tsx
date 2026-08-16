/**
 * 编辑器面板：元素属性（单选/锚点）、多选操作（含【新增】多选旋转）、添加元素条、手绘板。
 */
import { useRef, useState } from 'react';
import { ElementKind, LabelElement, TextEnhance, clamp } from '../model/document';
import { BARCODE_FORMATS, FONT_OPTIONS, QR_PRESETS } from '../model/presets';
import { DITHER_OPTIONS } from '../render/dither';
import { TEXT_ENHANCE_OPTIONS } from '../render/textEnhance';
import { FONT_FILE_ACCEPT, addUserFont, listUserFonts, removeUserFont } from '../data/fonts';
import { NumberField } from '../components/NumberField';

/** 形状选项（与安卓参考版 ShapeKind 对齐） */
const SHAPE_OPTIONS: Array<{ value: ShapeType; label: string }> = [
  { value: 'rect', label: '矩形' }, { value: 'roundedRect', label: '圆角矩形' },
  { value: 'circle', label: '圆形' }, { value: 'ellipse', label: '椭圆' },
  { value: 'triangle', label: '三角形' }, { value: 'diamond', label: '菱形' },
  { value: 'pentagon', label: '五边形' }, { value: 'hexagon', label: '六边形' },
  { value: 'star', label: '五角星' }, { value: 'heart', label: '心形' },
  { value: 'line', label: '直线' }, { value: 'verticalLine', label: '竖线' },
  { value: 'dashedLine', label: '虚线' }, { value: 'dashedVerticalLine', label: '竖虚线' },
  { value: 'arrow', label: '箭头 →' }, { value: 'arrowLeft', label: '箭头 ←' },
  { value: 'arrowUp', label: '箭头 ↑' }, { value: 'arrowDown', label: '箭头 ↓' },
  { value: 'plus', label: '加号' }, { value: 'checkmark', label: '对勾' },
  { value: 'speechBubble', label: '对话气泡' }, { value: 'cross', label: '叉号' },
];
import { EditorSession } from './session';
import { ShapeType } from '../model/document';

/* ------------------------------- 小控件 ------------------------------- */

function Num({ label, value, onChange, min, max }: {
  label: string; value: number; onChange: (v: number) => void; min?: number; max?: number;
}) {
  return (
    <label className="num-field">
      <span>{label}</span>
      <NumberField value={value} onCommit={onChange} min={min} max={max} />
    </label>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="panel-row">{children}</div>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="panel-section">
      <div className="panel-section-title">{title}</div>
      {children}
    </div>
  );
}

/* ------------------------------ 元素属性面板 ------------------------------ */

export function ElementPanel({ session }: { session: EditorSession }) {
  const snap = session.getSnapshot();
  const el = snap.anchor;
  const fileRef = useRef<HTMLInputElement>(null);
  const fontFileRef = useRef<HTMLInputElement>(null);
  const [userFonts, setUserFonts] = useState(listUserFonts());
  if (!el) return null;
  const multi = snap.selectedElements.length > 1;
  const upd = (patch: Partial<LabelElement>) => session.update({ ...el, ...patch });

  const importFont = async (file: File) => {
    try {
      const meta = await addUserFont(file);
      setUserFonts(listUserFonts());
      upd({ fontFamily: `"${meta.family}", sans-serif` });
    } catch (e) {
      window.alert(`字体导入失败：${String(e)}`);
    }
  };

  const pickImage = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => upd({ src: String(reader.result) });
    reader.readAsDataURL(file);
  };

  return (
    <div className="element-panel">
      <Section title={`位置与尺寸${multi ? `（已选 ${snap.selectedElements.length} 个，旋转将整体生效）` : ''}`}>
        <Row>
          <Num label="X" value={el.x} onChange={(v) => upd({ x: v })} />
          <Num label="Y" value={el.y} onChange={(v) => upd({ y: v })} />
          <Num label="宽" value={el.width} min={16} onChange={(v) => upd({ width: v })} />
          <Num label="高" value={el.height} min={16} onChange={(v) => upd({ height: v })} />
        </Row>
        <Row>
          <span className="slider-label">旋转{multi ? '（整体）' : ''}</span>
          <input
            type="range" min={-180} max={180} step={1} value={el.rotation}
            onChange={(e) => session.setRotationAbsolute(Number(e.target.value))}
            onPointerUp={() => session.endTransform()}
          />
          <Num label="角度°" value={el.rotation} min={-180} max={180}
            onChange={(v) => { session.setRotationAbsolute(v); session.endTransform(); }} />
        </Row>
        <Row>
          <label className="check"><input type="checkbox" checked={el.locked} onChange={(e) => upd({ locked: e.target.checked })} /> 锁定</label>
          <label className="check" title="元素区域黑白反转：内容变白、背景变黑（黑底白字效果）">
            <input type="checkbox" checked={el.invert} onChange={(e) => upd({ invert: e.target.checked })} /> 反色
          </label>
          {(el.kind === 'qrcode' || el.kind === 'barcode') && el.invert && (
            <span className="hint-text">反色码可能无法被部分扫码设备识别</span>
          )}
        </Row>
      </Section>

      {(el.kind === 'text' || el.kind === 'datetime' || el.kind === 'sequence') && (
        <Section title="文字">
          {el.kind === 'text' && (
            <textarea className="panel-textarea" value={el.text} rows={3}
              onChange={(e) => upd({ text: e.target.value })} placeholder="输入文字内容" />
          )}
          {el.kind === 'datetime' && (
            <input className="panel-input" value={el.dateTimeFormat}
              onChange={(e) => upd({ dateTimeFormat: e.target.value })} placeholder="YYYY-MM-DD HH:mm" />
          )}
          {el.kind === 'sequence' && (
            <>
              <Row>
                <Num label="起始" value={el.seqStart} onChange={(v) => upd({ seqStart: v })} />
                <Num label="步进" value={el.seqStep} onChange={(v) => upd({ seqStep: v })} />
                <Num label="位数" value={el.seqDigits} min={0} max={12} onChange={(v) => upd({ seqDigits: Math.round(v) })} />
              </Row>
              <Row>
                <input className="panel-input" style={{ width: 70 }} value={el.seqPrefix} placeholder="前缀" onChange={(e) => upd({ seqPrefix: e.target.value })} />
                <input className="panel-input" style={{ width: 70 }} value={el.seqSuffix} placeholder="后缀" onChange={(e) => upd({ seqSuffix: e.target.value })} />
                <span className="hint-text">位数 0 = 不补位；如 4 → 0001</span>
              </Row>
            </>
          )}
          <Row>
            <select className="panel-select" value={el.fontFamily} onChange={(e) => upd({ fontFamily: e.target.value })}>
              {FONT_OPTIONS.map((f) => <option key={f.label} value={f.value}>{f.label}</option>)}
              {userFonts.map((f) => (
                <option key={f.family} value={`"${f.family}", sans-serif`}>{f.label}（自定义）</option>
              ))}
            </select>
            <Num label="字号" value={el.fontSizeDots} min={8} max={240} onChange={(v) => upd({ fontSizeDots: v })} />
            <Num label="字重" value={el.fontWeight} min={100} max={900} onChange={(v) => upd({ fontWeight: v })} />
          </Row>
          <Row>
            <select
              className="panel-select" value={el.textEnhance}
              title="打印清晰度增强（本机浓度指令不生效，清晰度靠软件算法补偿）"
              onChange={(e) => upd({ textEnhance: e.target.value as TextEnhance })}
            >
              {TEXT_ENHANCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <span className="hint-text">
              {TEXT_ENHANCE_OPTIONS.find((o) => o.value === el.textEnhance)?.hint}
            </span>
          </Row>
          <Row>
            <span className="slider-label">字重 {el.fontWeight}</span>
            <input
              type="range" min={100} max={900} step={1} value={el.fontWeight}
              onChange={(e) => upd({ fontWeight: Number(e.target.value) })}
            />
            <span className="hint-text">100 细 – 900 粗，无极可调</span>
          </Row>
          <Row>
            <button className="chip" onClick={() => fontFileRef.current?.click()}>导入字体…</button>
            {userFonts.some((f) => el.fontFamily.includes(f.family)) && (
              <button
                className="chip danger"
                onClick={() => {
                  const meta = userFonts.find((f) => el.fontFamily.includes(f.family));
                  if (!meta) return;
                  void removeUserFont(meta.family).then(() => {
                    setUserFonts(listUserFonts());
                    upd({ fontFamily: FONT_OPTIONS[0].value });
                  });
                }}
              >删除当前自定义字体</button>
            )}
            <input
              ref={fontFileRef} type="file" hidden accept={FONT_FILE_ACCEPT}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFont(f); e.target.value = ''; }}
            />
          </Row>
          <Row>
            <label className="check"><input type="checkbox" checked={el.italic} onChange={(e) => upd({ italic: e.target.checked })} /> 斜体</label>
            <label className="check"><input type="checkbox" checked={el.underline} onChange={(e) => upd({ underline: e.target.checked })} /> 下划线</label>
            <label className="check"><input type="checkbox" checked={el.verticalText} onChange={(e) => upd({ verticalText: e.target.checked })} /> 竖排</label>
            <span className="btn-group">
              {(['left', 'center', 'right'] as const).map((a) => (
                <button key={a} className={`chip${el.align === a ? ' active' : ''}`} onClick={() => upd({ align: a })}>
                  {a === 'left' ? '左' : a === 'center' ? '中' : '右'}
                </button>
              ))}
            </span>
          </Row>
          <Row>
            <Num label="字间距" value={el.letterSpacingDots} min={-12} max={64} onChange={(v) => upd({ letterSpacingDots: v })} />
            <Num label="行间距" value={el.lineSpacingDots} min={-32} max={128} onChange={(v) => upd({ lineSpacingDots: v })} />
          </Row>
        </Section>
      )}

      {el.kind === 'image' && (
        <Section title="图片">
          <Row>
            <button className="btn" onClick={() => fileRef.current?.click()}>选择/替换图片</button>
            <input ref={fileRef} type="file" accept="image/*" hidden
              onChange={(e) => { const f = e.target.files?.[0]; if (f) pickImage(f); e.target.value = ''; }} />
            <span className="btn-group">
              {(['fit', 'crop', 'stretch'] as const).map((f) => (
                <button key={f} className={`chip${el.imageFit === f ? ' active' : ''}`} onClick={() => upd({ imageFit: f })}>
                  {f === 'fit' ? '适应' : f === 'crop' ? '裁切' : '拉伸'}
                </button>
              ))}
            </span>
          </Row>
          <Row>
            <Num label="亮度" value={el.brightness} min={-100} max={100} onChange={(v) => upd({ brightness: v })} />
            <Num label="对比度" value={el.contrast} min={-100} max={100} onChange={(v) => upd({ contrast: v })} />
          </Row>
          <Row>
            <span className="slider-label">阈值 {el.threshold}</span>
            <input type="range" min={0} max={255} value={el.threshold} onChange={(e) => upd({ threshold: Number(e.target.value) })} />
          </Row>
          <Row>
            <span className="slider-label">抖动</span>
            <select className="panel-select" value={el.ditherMode}
              onChange={(e) => upd({ ditherMode: e.target.value as LabelElement['ditherMode'] })}>
              {DITHER_OPTIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </Row>
          <div className="hint-text">{DITHER_OPTIONS.find((d) => d.value === el.ditherMode)?.hint}</div>
        </Section>
      )}

      {(el.kind === 'qrcode' || el.kind === 'barcode') && (
        <Section title={el.kind === 'qrcode' ? '二维码' : '一维 / 二维条码'}>
          {el.kind === 'barcode' && (
            <Row>
              <select className="panel-select" value={el.codeFormat} onChange={(e) => upd({ codeFormat: e.target.value })}>
                {BARCODE_FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </Row>
          )}
          {el.kind === 'qrcode' && (
            <Row>
              <select
                className="panel-select" value=""
                onChange={(e) => { if (e.target.value) upd({ codeValue: e.target.value }); }}
              >
                <option value="">内容预设…</option>
                {QR_PRESETS.map((p) => <option key={p.label} value={p.value}>{p.label}</option>)}
              </select>
            </Row>
          )}
          <textarea className="panel-textarea" value={el.codeValue} rows={2}
            onChange={(e) => upd({ codeValue: e.target.value })} placeholder="码内容" />
        </Section>
      )}

      {el.kind === 'shape' && (
        <Section title="形状">
          <Row>
            <select className="panel-select" value={el.shapeType} onChange={(e) => upd({ shapeType: e.target.value as ShapeType })}>
              {SHAPE_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <label className="check"><input type="checkbox" checked={el.filled} onChange={(e) => upd({ filled: e.target.checked })} /> 填充</label>
            <Num label="线宽" value={el.strokeWidthDots} min={1} max={40} onChange={(v) => upd({ strokeWidthDots: v })} />
          </Row>
        </Section>
      )}

      {el.kind === 'table' && <TableEditor el={el} onChange={upd} />}

      {el.kind === 'drawing' && (
        <Section title="手绘">
          <Row>
            <DrawingPadButton el={el} onChange={upd} />
            <button className="btn" onClick={() => upd({ drawingPoints: [] })}>清空笔迹</button>
            <Num label="笔宽" value={el.strokeWidthDots} min={1} max={40} onChange={(v) => upd({ strokeWidthDots: v })} />
          </Row>
        </Section>
      )}
    </div>
  );
}

/* ------------------------------- 表格编辑 ------------------------------- */

function TableEditor({ el, onChange }: { el: LabelElement; onChange: (p: Partial<LabelElement>) => void }) {
  const setCell = (r: number, c: number, v: string) => {
    const cells = [...el.tableCells];
    cells[r * el.tableCols + c] = v;
    onChange({ tableCells: cells });
  };
  const resize = (rows: number, cols: number) => {
    rows = clamp(rows, 1, 20); cols = clamp(cols, 1, 8);
    const cells: string[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        cells.push(r < el.tableRows && c < el.tableCols ? el.tableCells[r * el.tableCols + c] ?? '' : '');
      }
    }
    onChange({ tableRows: rows, tableCols: cols, tableCells: cells });
  };
  return (
    <Section title="表格">
      <Row>
        <Num label="行" value={el.tableRows} min={1} max={20} onChange={(v) => resize(v, el.tableCols)} />
        <Num label="列" value={el.tableCols} min={1} max={8} onChange={(v) => resize(el.tableRows, v)} />
        <Num label="字号" value={el.fontSizeDots} min={8} max={60} onChange={(v) => onChange({ fontSizeDots: v })} />
      </Row>
      <div className="table-cell-grid" style={{ gridTemplateColumns: `repeat(${el.tableCols}, 1fr)` }}>
        {Array.from({ length: el.tableRows * el.tableCols }, (_, i) => (
          <input key={i} className="panel-input" value={el.tableCells[i] ?? ''}
            onChange={(e) => setCell(Math.floor(i / el.tableCols), i % el.tableCols, e.target.value)} />
        ))}
      </div>
    </Section>
  );
}

/* ------------------------------- 手绘板 ------------------------------- */

function DrawingPadButton({ el, onChange }: { el: LabelElement; onChange: (p: Partial<LabelElement>) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn" onClick={() => setOpen(true)}>打开手绘板</button>
      {open && <DrawingPad initial={el.drawingPoints} onDone={(pts) => { onChange({ drawingPoints: pts }); setOpen(false); }} onCancel={() => setOpen(false)} />}
    </>
  );
}

export function DrawingPad({ initial, onDone, onCancel }: {
  initial: number[]; onDone: (pts: number[]) => void; onCancel: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const points = useRef<number[]>([...initial]);

  const redraw = () => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    let pen = false;
    const pts = points.current;
    for (let i = 0; i + 1 < pts.length; i += 2) {
      if (pts[i] < 0 || pts[i + 1] < 0) { pen = false; continue; }
      const x = pts[i] * canvas.width;
      const y = pts[i + 1] * canvas.height;
      if (!pen) { ctx.moveTo(x, y); pen = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke();
  };

  const add = (ev: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    points.current.push((ev.clientX - rect.left) / rect.width, (ev.clientY - rect.top) / rect.height);
    redraw();
  };

  return (
    <div className="modal-mask" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal">
        <div className="modal-title">手绘 / 签名</div>
        <canvas
          ref={canvasRef} width={640} height={360} className="drawing-pad"
          onPointerDown={(e) => { (e.target as Element).setPointerCapture(e.pointerId); drawing.current = true; add(e); }}
          onPointerMove={(e) => drawing.current && add(e)}
          onPointerUp={() => { drawing.current = false; points.current.push(-1, -1); }}
        />
        <div className="modal-actions">
          <button className="btn" onClick={() => { points.current = []; redraw(); }}>清空</button>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onCancel}>取消</button>
          <button className="btn primary" onClick={() => onDone(points.current)}>完成</button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ 多选操作面板 ------------------------------ */

export function MultiPanel({ session }: { session: EditorSession }) {
  const snap = session.getSnapshot();
  const count = snap.selectedElements.length;
  if (count < 2) return null;
  const grouped = snap.selectedElements.every((e) => e.groupId && e.groupId === snap.selectedElements[0].groupId);

  const rotateBy = (deg: number) => {
    session.beginTransform();
    session.rotateSelected(deg);
    session.endTransform();
  };

  return (
    <div className="element-panel">
      <Section title={`已选择 ${count} 个元素`}>
        <div className="hint-text">拖动可整体移动；八向手柄整体缩放；顶部圆点或下方按钮整体旋转。</div>
      </Section>
      <Section title="旋转（全选也能转）">
        <Row>
          <button className="btn" onClick={() => rotateBy(-90)}>↺ 90°</button>
          <button className="btn" onClick={() => rotateBy(-15)}>↺ 15°</button>
          <button className="btn" onClick={() => rotateBy(15)}>15° ↻</button>
          <button className="btn" onClick={() => rotateBy(90)}>90° ↻</button>
        </Row>
      </Section>
      <Section title="对齐">
        <Row>
          {([
            ['left', '左对齐'], ['hcenter', '水平居中'], ['right', '右对齐'],
            ['top', '顶对齐'], ['vcenter', '垂直居中'], ['bottom', '底对齐'],
          ] as const).map(([a, label]) => (
            <button key={a} className="chip" onClick={() => session.alignSelected(a)}>{label}</button>
          ))}
        </Row>
      </Section>
      <Section title="等距分布（至少 3 个）">
        <Row>
          <button className="btn" disabled={count < 3} onClick={() => session.distributeSelected(true)}>水平等距</button>
          <button className="btn" disabled={count < 3} onClick={() => session.distributeSelected(false)}>垂直等距</button>
        </Row>
      </Section>
      <Section title="组合与操作">
        <Row>
          <button className="btn" onClick={() => (grouped ? session.ungroupSelected() : session.groupSelected())}>
            {grouped ? '取消组合' : '组合'}
          </button>
          <button className="btn" onClick={() => session.duplicateSelected()}>复制整组</button>
          <button className="btn danger" onClick={() => session.deleteSelected()}>删除所选</button>
        </Row>
      </Section>
    </div>
  );
}

/* ------------------------------ 添加元素条 ------------------------------ */

const ADD_ITEMS: Array<{ kind: ElementKind; label: string }> = [
  { kind: 'text', label: '文字' },
  { kind: 'image', label: '图片' },
  { kind: 'qrcode', label: '二维码' },
  { kind: 'barcode', label: '条码' },
  { kind: 'shape', label: '形状' },
  { kind: 'table', label: '表格' },
  { kind: 'datetime', label: '日期时间' },
  { kind: 'sequence', label: '流水号' },
  { kind: 'drawing', label: '手绘' },
];

export function AddElementBar({ onAdd }: { onAdd: (kind: ElementKind) => void }) {
  return (
    <div className="add-bar">
      {ADD_ITEMS.map((it) => (
        <button key={it.kind} className="chip" onClick={() => onAdd(it.kind)}>+ {it.label}</button>
      ))}
    </div>
  );
}
