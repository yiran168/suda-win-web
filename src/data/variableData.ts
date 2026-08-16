/**
 * 变量数据（对齐安卓参考版 VariableDataParser）：
 * 解析 CSV / TSV / 粘贴表格 / xlsx 为「列 + 行」表；
 * 文字、表格单元格与码内容里的 {{字段名}} 占位符在批量打印时逐行替换。
 */
import * as XLSX from 'xlsx';

export interface VariableDataTable {
  sourceName: string;
  columns: string[];
  rows: Array<Record<string, string>>;
}

/** 解析 CSV/TSV 文本（自动识别分隔符，支持引号包裹与转义） */
export function parseDelimited(sourceName: string, text: string): VariableDataTable {
  const matrix = parseDelimitedMatrix(text);
  return tableFromMatrix(sourceName, matrix);
}

/** 解析 xlsx / xls / csv 文件 */
export async function parseWorkbook(file: File): Promise<VariableDataTable> {
  if (/\.(csv|txt|tsv)$/i.test(file.name)) {
    return parseDelimited(file.name, await file.text());
  }
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error('工作簿为空');
  const matrix = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: '' });
  return tableFromMatrix(file.name, matrix.map((row) => row.map((c) => String(c ?? ''))));
}

function tableFromMatrix(sourceName: string, matrix: string[][]): VariableDataTable {
  const width = matrix.reduce((m, r) => Math.max(m, r.length), 0);
  if (!width) throw new Error('未解析到有效数据');
  const header = matrix[0] ?? [];
  const columns: string[] = [];
  for (let c = 0; c < width; c++) {
    const name = (header[c] ?? '').trim();
    columns.push(name || `列${c + 1}`);
  }
  const rows: Array<Record<string, string>> = [];
  for (let r = 1; r < matrix.length; r++) {
    const line = matrix[r];
    if (!line || line.every((c) => !String(c).trim())) continue;
    const row: Record<string, string> = {};
    for (let c = 0; c < width; c++) row[columns[c]] = String(line[c] ?? '').trim();
    rows.push(row);
  }
  if (!rows.length) throw new Error('只有表头，没有数据行');
  return { sourceName, columns, rows };
}

function parseDelimitedMatrix(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let delimiter = '';
  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      pushRow();
      continue;
    }
    if (!delimiter && (ch === ',' || ch === '\t' || ch === ';')) delimiter = ch;
    if (ch === delimiter) { pushField(); continue; }
    field += ch;
  }
  if (field || row.length) pushRow();
  return rows.filter((r) => r.some((c) => c.trim()));
}

/** 替换文本中的 {{字段}} 占位符；未知字段原样保留 */
export function substituteVariables(text: string, row: Record<string, string>): string {
  return text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (raw, name: string) => {
    const key = name.trim();
    return key in row ? row[key] : raw;
  });
}

/** 收集文档中实际用到的变量字段名 */
export function fieldsUsedIn(texts: string[]): string[] {
  const found = new Set<string>();
  for (const t of texts) {
    for (const m of t.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) found.add(m[1].trim());
  }
  return [...found];
}
