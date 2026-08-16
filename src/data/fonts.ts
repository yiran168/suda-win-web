/**
 * 自定义字体（对齐安卓参考版 UserFontStore）：
 * 字体文件存 IndexedDB，元信息存 localStorage；启动与导入时经 FontFace 注册，
 * 画布预览、最终预览与打印光栅共用同一套字体（同源渲染）。
 */

export interface UserFontMeta {
  /** 注册进 FontFace 的 family 名（以 UF- 开头，避免与系统字体冲突） */
  family: string;
  /** 展示名（文件名去扩展名） */
  label: string;
  addedAt: number;
}

const META_KEY = 'qrint.fonts.v1';
const DB_NAME = 'qrint-fonts';
const STORE = 'files';

/* ------------------------------- 元信息 ------------------------------- */

export function listUserFonts(): UserFontMeta[] {
  try {
    const raw = localStorage.getItem(META_KEY);
    return raw ? (JSON.parse(raw) as UserFontMeta[]) : [];
  } catch { return []; }
}

function saveMeta(list: UserFontMeta[]): void {
  localStorage.setItem(META_KEY, JSON.stringify(list));
}

/* ------------------------------ IndexedDB ------------------------------ */

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function putBlob(key: string, data: ArrayBuffer): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(data, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getBlob(key: string): Promise<ArrayBuffer | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve((req.result as ArrayBuffer | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function deleteBlob(key: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* ------------------------------ FontFace ------------------------------ */

const registered = new Map<string, FontFace>();

async function registerFont(meta: UserFontMeta): Promise<void> {
  if (registered.has(meta.family)) return;
  const buf = await getBlob(meta.family);
  if (!buf) return;
  const face = new FontFace(meta.family, buf);
  await face.load();
  document.fonts.add(face);
  registered.set(meta.family, face);
}

/** App 启动时调用：恢复全部已导入字体 */
export async function registerAllUserFonts(): Promise<void> {
  for (const meta of listUserFonts()) {
    try { await registerFont(meta); } catch { /* 单个字体损坏不影响其余 */ }
  }
}

export const FONT_FILE_ACCEPT = '.ttf,.otf,.woff,.woff2';

export async function addUserFont(file: File): Promise<UserFontMeta> {
  const meta: UserFontMeta = {
    family: `UF-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    label: file.name.replace(/\.(ttf|otf|woff2?)$/i, '') || file.name,
    addedAt: Date.now(),
  };
  await putBlob(meta.family, await file.arrayBuffer());
  saveMeta([...listUserFonts(), meta]);
  await registerFont(meta);
  return meta;
}

export async function removeUserFont(family: string): Promise<void> {
  const face = registered.get(family);
  if (face) { document.fonts.delete(face); registered.delete(family); }
  saveMeta(listUserFonts().filter((m) => m.family !== family));
  try { await deleteBlob(family); } catch { /* 忽略 */ }
}
