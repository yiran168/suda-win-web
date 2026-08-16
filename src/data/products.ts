/**
 * 商品资料库（对齐安卓参考版 ProductLibraryStore）：
 * localStorage 持久化；编辑器内可检索并把商品字段一键插入画布。
 */

export interface ProductRecord {
  id: string;
  barcode: string;
  name: string;
  sku: string;
  spec: string;
  price: string;
  unit: string;
  category: string;
  brand: string;
  note: string;
  updatedAt: number;
}

const KEY = 'qrint.products.v1';

export function blankProduct(): ProductRecord {
  return {
    id: `pd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    barcode: '', name: '', sku: '', spec: '', price: '', unit: '',
    category: '', brand: '', note: '', updatedAt: Date.now(),
  };
}

export function loadProducts(): ProductRecord[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    return (JSON.parse(raw) as ProductRecord[]).sort((a, b) => b.updatedAt - a.updatedAt);
  } catch { return []; }
}

function save(list: ProductRecord[]): void {
  localStorage.setItem(KEY, JSON.stringify(list));
}

export function upsertProduct(rec: ProductRecord): ProductRecord[] {
  const next = { ...rec, updatedAt: Date.now() };
  const list = loadProducts();
  const i = list.findIndex((p) => p.id === next.id);
  if (i >= 0) list[i] = next; else list.unshift(next);
  save(list);
  return list;
}

export function removeProduct(id: string): ProductRecord[] {
  const list = loadProducts().filter((p) => p.id !== id);
  save(list);
  return list;
}

export function searchProducts(list: ProductRecord[], keyword: string): ProductRecord[] {
  const k = keyword.trim().toLowerCase();
  if (!k) return list;
  return list.filter((p) =>
    [p.name, p.sku, p.barcode, p.spec, p.category, p.brand, p.note]
      .some((f) => f.toLowerCase().includes(k)));
}
