/**
 * Excel workbooks from calculator results. A workbook spec is plain JSON (so tools can return it and the browser can
 * post it back): sheets of rows whose cells are values or formulas ("=B2*C2"), with simple styling. Formulas stay live
 * in the downloaded file, so an engineer can change a rate or a duration and Excel recalculates.
 */
import ExcelJS from "exceljs";

export type { CellSpec, SheetSpec, WorkbookSpec } from "./workbook";
export { sheetRow, tableWorkbook } from "./workbook";
import type { WorkbookSpec } from "./workbook";

const safeSheetName = (s: string) => s.replace(/[\\/*?:[\]]/g, " ").slice(0, 31) || "Sheet";

export async function buildWorkbook(spec: WorkbookSpec): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "CivilMate";
  wb.created = new Date();
  wb.title = spec.title;
  wb.calcProperties.fullCalcOnLoad = true; // Excel recalculates every formula when the file opens
  for (const sh of spec.sheets) {
    const ws = wb.addWorksheet(safeSheetName(sh.name));
    let offset = 0;
    if (sh.title) { ws.addRow([sh.title]).font = { bold: true, size: 13 }; ws.addRow([]); offset = 2; }
    if (sh.columns) {
      const hr = ws.addRow(sh.columns.map((c) => c.header));
      hr.font = { bold: true };
      hr.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EDF3" } }; c.border = { bottom: { style: "thin" } }; });
      sh.columns.forEach((c, i) => { const col = ws.getColumn(i + 1); col.width = c.width ?? Math.max(10, Math.min(48, c.header.length + 4)); if (c.numFmt) col.numFmt = c.numFmt; });
      offset += 1;
    }
    for (const r of sh.rows) {
      ws.addRow(r.map((c) => {
        if (c && typeof c === "object" && "f" in c) return { formula: c.f.replace(/^=/, ""), result: c.v };
        if (c && typeof c === "object" && "date" in c) return new Date(`${c.date}T00:00:00Z`);
        return c;
      }));
    }
    for (const r of sh.boldRows ?? []) ws.getRow(r + offset).font = { bold: true };
    for (const [r, c0, c1, argb] of sh.fills ?? []) for (let c = c0; c <= c1; c++) ws.getRow(r + offset).getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
    if (sh.freeze) ws.views = [{ state: "frozen", xSplit: sh.freeze.col, ySplit: offset + sh.freeze.row }];
    if (sh.notes?.length) { ws.addRow([]); for (const n of sh.notes) ws.addRow([n]).font = { italic: true, color: { argb: "FF666666" } }; }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
