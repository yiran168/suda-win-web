/**
 * 纸张设置控件：纸型（连续/标签）、尺寸预设与自定义、标签间隙、形状、
 * 打印后走纸、窄纸装入位置（纸宽 < 打印头时出现）。
 * 新建画布对话框与文档直印批次对话框共用（DRY）。
 */
import { PaperSettings, mmToDots, dotsToMm, paperWidthDots, printerConfig } from '../model/document';
import { CONTINUOUS_PRESETS, LABEL_PRESETS } from '../model/presets';
import { NumberField } from './NumberField';

export function PaperSettingsFields({ paper, onChange }: {
  paper: PaperSettings;
  onChange: (p: PaperSettings) => void;
}) {
  return (
    <>
      <div className="panel-section">
        <div className="panel-section-title">纸张类型</div>
        <div className="panel-row">
          <button className={`chip${paper.mode === 'continuous' ? ' active' : ''}`}
            onClick={() => onChange({ ...paper, mode: 'continuous' })}>连续纸（自动算长）</button>
          <button className={`chip${paper.mode === 'label' ? ' active' : ''}`}
            onClick={() => onChange({ ...paper, mode: 'label' })}>标签纸（固定尺寸）</button>
        </div>
      </div>
      <div className="panel-section">
        <div className="panel-section-title">{paper.mode === 'continuous' ? '纸宽（mm）' : '标签尺寸（mm）'}</div>
        <div className="panel-row preset-row">
          {paper.mode === 'continuous'
            ? CONTINUOUS_PRESETS.map((w) => (
              <button key={w} className={`chip preset${paper.widthMm === w ? ' active' : ''}`}
                onClick={() => onChange({ ...paper, widthMm: w })}>{w}</button>
            ))
            : LABEL_PRESETS.map(([w, h]) => (
              <button key={`${w}x${h}`} className={`chip preset${paper.widthMm === w && paper.labelHeightMm === h ? ' active' : ''}`}
                onClick={() => onChange({ ...paper, widthMm: w, labelHeightMm: h })}>{w}×{h}</button>
            ))}
        </div>
        <div className="panel-row">
          <label className="num-field"><span>宽 mm</span>
            <NumberField step={0.1} min={10} max={57} value={paper.widthMm}
              onCommit={(v) => onChange({ ...paper, widthMm: v })} /></label>
          {paper.mode === 'label' && (
            <>
              <label className="num-field"><span>长 mm</span>
                <NumberField step={0.1} min={5} max={300} value={paper.labelHeightMm}
                  onCommit={(v) => onChange({ ...paper, labelHeightMm: v })} /></label>
              <label className="num-field"><span>间隙 mm</span>
                <NumberField step={0.1} min={0} max={50} value={paper.labelGapMm}
                  onCommit={(v) => onChange({ ...paper, labelGapMm: v })} /></label>
            </>
          )}
          <label className="num-field"><span>形状</span>
            <select className="panel-select" value={paper.shape}
              onChange={(e) => onChange({ ...paper, shape: e.target.value as PaperSettings['shape'] })}>
              <option value="rect">矩形</option><option value="rounded">圆角</option><option value="oval">椭圆</option>
            </select></label>
        </div>
        <div className="panel-row">
          <label className="num-field"><span>打印后走纸 mm</span>
            <NumberField step={0.5} min={0} max={100} value={dotsToMm(paper.tailFeedDots)}
              onCommit={(v) => onChange({ ...paper, tailFeedDots: mmToDots(v) })} />
          </label>
          <span className="hint-text">连续纸打印完成后额外送纸距离，方便撕纸；0 表示不走纸。标签纸只按间隙走纸，此设置不生效</span>
        </div>
        {paperWidthDots(paper) < printerConfig.headDots && (
          <div className="panel-row">
            <span className="num-field"><span>窄纸装入位置</span></span>
            {([['left', '靠左'], ['center', '居中'], ['right', '靠右']] as const).map(([v, label]) => (
              <button key={v} className={`chip${paper.anchor === v ? ' active' : ''}`}
                onClick={() => onChange({ ...paper, anchor: v })}>{label}</button>
            ))}
            <span className="hint-text">纸卷比打印头窄时，纸靠在机器的哪一侧（对齐安卓版「纸张靠左/靠右」）</span>
          </div>
        )}
      </div>
    </>
  );
}
