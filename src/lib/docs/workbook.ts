/** Workbook spec (plain JSON, no exceljs) shared by tools, the browser and the xlsx builder in ./xlsx.ts. */
export type CellSpec = string | number | boolean | null | { f: string; v?: number | string } | { date: string };
export interface SheetSpec {
  name: string;
  columns?: { header: string; width?: number; numFmt?: string }[];
  rows: CellSpec[][];
  /** 1-based row numbers to render bold (e.g. totals) */
  boldRows?: number[];
  /** Gantt-style fills: [row, fromCol, toCol, argb colour] (1-based) */
  fills?: [number, number, number, string][];
  /** Freeze the title/header rows plus this many data rows, and this many columns from the left. */
  freeze?: { row: number; col: number };
  title?: string; // written above the table
  notes?: string[]; // written below the table
}
export interface WorkbookSpec { title: string; sheets: SheetSpec[] }

/** Spreadsheet row (1-based) of data row i (0-based) in a sheet built by buildWorkbook: below the title and header. */
export const sheetRow = (sh: Pick<SheetSpec, "title" | "columns">, i: number) => i + 1 + (sh.title ? 2 : 0) + (sh.columns ? 1 : 0);

/** A simple one-sheet workbook from a table (any calculator's table output). */
export function tableWorkbook(title: string, columns: string[], rows: (string | number)[][]): WorkbookSpec {
  return { title, sheets: [{ name: title, title, columns: columns.map((h) => ({ header: h })), rows: rows.map((r) => r.map((c) => (typeof c === "string" && /^-?\d+(\.\d+)?$/.test(c.trim()) ? Number(c) : c))) }] };
}
