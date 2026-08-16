/**
 * 商品资料库弹窗（对齐安卓 ProductLibrarySheet）：
 * 检索 / 新增 / 编辑 / 删除商品，名称、价格、条码一键插入画布。
 */
import { useState } from 'react';
import {
  ProductRecord, blankProduct, loadProducts, removeProduct, searchProducts, upsertProduct,
} from '../data/products';
import { EditorSession } from './session';
import { createElement } from '../model/presets';
import { LabelElement, contentBottomDots, printableStartX } from '../model/document';

interface Props {
  session: EditorSession;
  onClose: () => void;
  onToast: (msg: string) => void;
}

export function ProductLibrarySheet({ session, onClose, onToast }: Props) {
  const [products, setProducts] = useState(loadProducts());
  const [keyword, setKeyword] = useState('');
  const [form, setForm] = useState<ProductRecord | null>(null);

  const shown = searchProducts(products, keyword);

  const nextPos = () => {
    const doc = session.getSnapshot().document;
    return { x: printableStartX(doc.paper) + 12, y: contentBottomDots(doc) + 8 };
  };

  const textEl = (text: string, y: number, bold = false): LabelElement => ({
    ...createElement('text', session.getSnapshot().document.paper),
    x: nextPos().x, y, width: 300, height: bold ? 44 : 40,
    text, fontSizeDots: bold ? 26 : 24, fontWeight: bold ? 700 : 400,
  });

  const barcodeEl = (p: ProductRecord, y: number): LabelElement => ({
    ...createElement('barcode', session.getSnapshot().document.paper),
    x: nextPos().x, y, width: 280, height: 84,
    codeValue: p.barcode,
    codeFormat: /^\d{13}$/.test(p.barcode) ? 'EAN13' : /^\d{8}$/.test(p.barcode) ? 'EAN8' : 'CODE128',
  });

  const insert = (p: ProductRecord, what: 'namePrice' | 'barcode' | 'all') => {
    const doc = session.getSnapshot().document;
    let y = contentBottomDots(doc) + 8;
    const els: LabelElement[] = [];
    if (what !== 'barcode') {
      els.push(textEl(p.name, y, true));
      y += 48;
      if (p.price) { els.push(textEl(`¥ ${p.price}${p.unit ? ` / ${p.unit}` : ''}`, y)); y += 44; }
    }
    if (what !== 'namePrice' && p.barcode) {
      els.push(barcodeEl(p, y));
    }
    if (!els.length) { onToast('该商品没有可插入的字段'); return; }
    els.forEach((el) => session.add(el));
    onToast(`已插入「${p.name || p.barcode}」`);
  };

  const saveForm = () => {
    if (!form) return;
    if (!form.name.trim() && !form.barcode.trim()) { onToast('名称与条码至少填一项'); return; }
    setProducts(upsertProduct(form));
    setForm(null);
    onToast('商品已保存');
  };

  const field = (label: string, key: keyof ProductRecord, placeholder = '') => (
    <label className="num-field" key={key} style={{ minWidth: 120, flex: 1 }}>
      <span>{label}</span>
      <input
        className="panel-input" value={String(form?.[key] ?? '')} placeholder={placeholder}
        onChange={(e) => form && setForm({ ...form, [key]: e.target.value })}
      />
    </label>
  );

  return (
    <div className="modal-mask" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 'min(720px, 96vw)' }}>
        <div className="modal-title">商品资料库</div>
        <div className="panel-row">
          <input
            className="panel-input" style={{ flex: 1 }} placeholder="搜索名称 / SKU / 条码 / 分类 / 品牌…"
            value={keyword} onChange={(e) => setKeyword(e.target.value)}
          />
          <button className="btn" onClick={() => setForm(blankProduct())}>＋ 新增商品</button>
        </div>

        {form && (
          <div className="card" style={{ padding: 14, margin: '10px 0' }}>
            <div className="panel-row" style={{ flexWrap: 'wrap', gap: 8 }}>
              {field('名称', 'name', '必填或可由条码代替')}
              {field('条码', 'barcode', 'EAN-13 / CODE128 内容')}
              {field('价格', 'price', '如 12.80')}
              {field('单位', 'unit', '个 / 瓶 / kg')}
              {field('规格', 'spec')}
              {field('SKU', 'sku')}
              {field('分类', 'category')}
              {field('品牌', 'brand')}
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setForm(null)}>取消</button>
              <span style={{ flex: 1 }} />
              <button className="btn primary" onClick={saveForm}>保存商品</button>
            </div>
          </div>
        )}

        <div className="product-list">
          {!shown.length && <div className="empty-state">{products.length ? '没有匹配的商品' : '还没有商品，点「新增商品」建立第一条资料'}</div>}
          {shown.map((p) => (
            <div key={p.id} className="product-row">
              <div className="product-main">
                <b>{p.name || '（未命名）'}</b>
                <span className="product-sub">
                  {[p.spec, p.brand, p.category].filter(Boolean).join(' · ') || ' '}
                </span>
                {p.barcode && <span className="product-sub">条码 {p.barcode}</span>}
              </div>
              <b className="product-price">{p.price ? `¥${p.price}` : ''}</b>
              <span className="btn-group">
                <button className="chip" onClick={() => insert(p, 'namePrice')}>名称价格</button>
                <button className="chip" disabled={!p.barcode} onClick={() => insert(p, 'barcode')}>条码</button>
                <button className="chip" disabled={!p.barcode} onClick={() => insert(p, 'all')}>整套</button>
                <button className="chip" onClick={() => setForm({ ...p })}>编辑</button>
                <button className="chip danger" onClick={() => setProducts(removeProduct(p.id))}>删</button>
              </span>
            </div>
          ))}
        </div>

        <div className="modal-actions">
          <span className="hint-text">共 {products.length} 条商品资料，保存在本机。</span>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>完成</button>
        </div>
      </div>
    </div>
  );
}
