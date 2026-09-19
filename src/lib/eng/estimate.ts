/**
 * Cost estimate / bill of quantities: Amount = Quantity × Rate, subtotals by category, then overhead, profit,
 * contingency and taxes on the running total. Rates are never invented: items without a rate are reported so the user
 * (or an uploaded schedule of rates) can supply them. The Excel export keeps every amount as a live formula.
 */
import { sheetRow, type WorkbookSpec, type CellSpec } from "@/lib/docs/workbook";

export interface EstimateItem { code?: string; description: string; unit: string; quantity: number; rate?: number; category?: string }
export interface EstimateInput {
  project?: string;
  currency?: string; // "BDT" (default) or "USD"
  items: EstimateItem[];
  overheadPercent?: number;
  profitPercent?: number;
  contingencyPercent?: number;
  vatPercent?: number; // applied after overhead, profit and contingency
  otherTaxPercent?: number; // e.g. AIT / sales tax, applied on the same base as VAT
  rateSource?: string; // e.g. "PWD Schedule of Rates 2022, Dhaka zone" or "company rates"
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function costEstimate(inp: EstimateInput) {
  if (!inp.items?.length) throw new Error("Give at least one item (description, unit, quantity, rate)");
  const cur = inp.currency ?? "BDT";
  const items = inp.items.map((it, i) => ({ no: i + 1, ...it, category: it.category || "General", amount: it.rate !== undefined ? r2(it.quantity * it.rate) : null }));
  const missing = items.filter((it) => it.amount === null).map((it) => `${it.no}. ${it.description}`);
  const subtotal = r2(items.reduce((s, it) => s + (it.amount ?? 0), 0));
  const byCategory = Object.entries(items.reduce<Record<string, number>>((m, it) => ({ ...m, [it.category]: (m[it.category] ?? 0) + (it.amount ?? 0) }), {})).map(([category, amount]) => ({ category, amount: r2(amount), percent: subtotal ? r2((100 * amount) / subtotal) : 0 }));
  const pct = (p?: number) => (p ?? 0) / 100;
  const overhead = r2(subtotal * pct(inp.overheadPercent));
  const profit = r2((subtotal + overhead) * pct(inp.profitPercent));
  const contingency = r2((subtotal + overhead + profit) * pct(inp.contingencyPercent));
  const beforeTax = r2(subtotal + overhead + profit + contingency);
  const vat = r2(beforeTax * pct(inp.vatPercent));
  const otherTax = r2(beforeTax * pct(inp.otherTaxPercent));
  const total = r2(beforeTax + vat + otherTax);
  return { project: inp.project ?? "Cost estimate", currency: cur, items, byCategory, subtotal, overhead, profit, contingency, beforeTax, vat, otherTax, total, missingRates: missing, rateSource: inp.rateSource ?? null };
}

/** Workbook with live formulas: amounts, subtotal, markups and taxes recalculate when a quantity or rate is edited. */
export function estimateWorkbook(inp: EstimateInput): WorkbookSpec {
  const r = costEstimate(inp);
  const title = `${r.project}: cost estimate (${r.currency})`;
  const layout = { title, columns: [{ header: "" }] };
  const R = (i: number) => sheetRow(layout, i); // spreadsheet row of data row i
  const n = r.items.length;
  const rows: CellSpec[][] = r.items.map((it, i) => [it.no, it.code ?? "", it.description, it.unit, it.quantity, it.rate ?? null, { f: `ROUND(E${R(i)}*F${R(i)},2)`, v: it.amount ?? 0 }, it.category]);
  rows.push([]);
  // Summary line k (1-based) sits at data row n + k (after one blank row).
  const g = (k: number) => `G${R(n + k)}`;
  const pctRow = (label: string, p: number | undefined, base: string, k: number, v: number): CellSpec[] => ["", "", label, "%", p ?? 0, null, { f: `ROUND(${base}*E${R(n + k)}/100,2)`, v }];
  rows.push(["", "", "Subtotal (direct cost)", "", "", "", { f: `SUM(G${R(0)}:G${R(n - 1)})`, v: r.subtotal }]); // k = 1
  rows.push(pctRow("Overhead", inp.overheadPercent, g(1), 2, r.overhead));
  rows.push(pctRow("Profit", inp.profitPercent, `(${g(1)}+${g(2)})`, 3, r.profit));
  rows.push(pctRow("Contingency", inp.contingencyPercent, `(${g(1)}+${g(2)}+${g(3)})`, 4, r.contingency));
  rows.push(["", "", "Total before tax", "", "", "", { f: `${g(1)}+${g(2)}+${g(3)}+${g(4)}`, v: r.beforeTax }]); // k = 5
  rows.push(pctRow("VAT", inp.vatPercent, g(5), 6, r.vat));
  rows.push(pctRow("Other tax (AIT / sales tax)", inp.otherTaxPercent, g(5), 7, r.otherTax));
  rows.push(["", "", `GRAND TOTAL (${r.currency})`, "", "", "", { f: `${g(5)}+${g(6)}+${g(7)}`, v: r.total }]); // k = 8
  const money = r.currency === "USD" ? '"$"#,##0.00' : "#,##0.00";
  const cat = { title: "Direct cost by category", columns: [{ header: "" }] };
  const subtotalRef = `Estimate!${g(1).replace("G", "$G$")}`;
  return {
    title: r.project,
    sheets: [
      {
        name: "Estimate", title,
        columns: [{ header: "No.", width: 6 }, { header: "Code", width: 10 }, { header: "Description", width: 52 }, { header: "Unit", width: 8 }, { header: "Quantity", width: 12, numFmt: "#,##0.00" }, { header: "Rate", width: 14, numFmt: money }, { header: "Amount", width: 16, numFmt: money }, { header: "Category", width: 16 }],
        rows, boldRows: [n + 2, n + 6, n + 9], freeze: { row: 0, col: 3 },
        notes: [
          `Rates: ${r.rateSource ?? "as entered by the user"}.${r.missingRates.length ? ` ${r.missingRates.length} item(s) have no rate yet: ${r.missingRates.join("; ")}.` : ""}`,
          "Amounts and totals are formulas: edit quantities, rates or percentages and Excel recalculates.",
          "Prepared with CivilMate. Check quantities and rates before use.",
        ],
      },
      {
        name: "By category", title: cat.title,
        columns: [{ header: "Category", width: 24 }, { header: "Amount", width: 16, numFmt: money }, { header: "% of direct cost", width: 16, numFmt: "0.0" }],
        rows: r.byCategory.map((c, i) => [c.category, { f: `SUMIF(Estimate!$H$${R(0)}:$H$${R(n - 1)},A${sheetRow(cat, i)},Estimate!$G$${R(0)}:$G$${R(n - 1)})`, v: c.amount }, { f: `IF(${subtotalRef}=0,0,100*B${sheetRow(cat, i)}/${subtotalRef})`, v: c.percent }]),
      },
    ],
  };
}
