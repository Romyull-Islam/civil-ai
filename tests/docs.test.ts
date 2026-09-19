/**
 * Documents and spreadsheets: CPM schedule (hand-computed networks), working-day calendar, cost estimate arithmetic,
 * document text extraction, and an independent recalculation of the exported Excel formulas by LibreOffice
 * (skipped when soffice is not installed).
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { criticalPath, projectSchedule, workCalendar, parseLink, scheduleWorkbook, type ScheduleInput } from "@/lib/eng/schedule";
import { costEstimate, estimateWorkbook, type EstimateInput } from "@/lib/eng/estimate";
import { buildWorkbook } from "@/lib/docs/xlsx";
import type { WorkbookSpec } from "@/lib/docs/workbook";
import { extractDocument, kindOf } from "@/lib/docs/extract";
import { runTool, selectToolsForText } from "@/lib/tools";

const byId = (rows: { id: string }[]) => Object.fromEntries(rows.map((r) => [r.id, r]));

describe("CPM schedule", () => {
  // Activity-on-node network, finish-to-start links. Forward/backward pass computed by hand:
  // A0-3, B3-7, C3-5, D7-12, E5-6, F5-7, G12-16, H16-19; LS: A0 B3 C9 D7 E11 F14 G12 H16.
  const net: ScheduleInput = { activities: [
    { id: "A", name: "A", duration: 3 }, { id: "B", name: "B", duration: 4, predecessors: ["A"] }, { id: "C", name: "C", duration: 2, predecessors: ["A"] },
    { id: "D", name: "D", duration: 5, predecessors: ["B"] }, { id: "E", name: "E", duration: 1, predecessors: ["C"] }, { id: "F", name: "F", duration: 2, predecessors: ["C"] },
    { id: "G", name: "G", duration: 4, predecessors: ["D", "E"] }, { id: "H", name: "H", duration: 3, predecessors: ["F", "G"] },
  ] };
  it("forward and backward pass, floats and critical path (finish-to-start)", () => {
    const r = criticalPath(net);
    expect(r.duration).toBe(19);
    const x = byId(r.rows) as Record<string, ReturnType<typeof criticalPath>["rows"][number]>;
    expect([x.A.ES, x.B.ES, x.C.ES, x.D.ES, x.E.ES, x.F.ES, x.G.ES, x.H.ES]).toEqual([0, 3, 3, 7, 5, 5, 12, 16]);
    expect([x.A.LS, x.B.LS, x.C.LS, x.D.LS, x.E.LS, x.F.LS, x.G.LS, x.H.LS]).toEqual([0, 3, 9, 7, 11, 14, 12, 16]);
    expect([x.C.totalFloat, x.E.totalFloat, x.F.totalFloat]).toEqual([6, 6, 9]);
    expect([x.C.freeFloat, x.E.freeFloat, x.F.freeFloat]).toEqual([0, 6, 9]);
    expect(r.critical).toEqual(["A", "B", "D", "G", "H"]);
  });
  it("precedence links with lags (SS, FF)", () => {
    // A 0-4; B SS+2 → 2-8; C FF+1 on B → EF ≥ 9 → 6-9; D FS on A → 4-6. Duration 9; D float 3.
    const r = criticalPath({ activities: [{ id: "A", name: "A", duration: 4 }, { id: "B", name: "B", duration: 6, predecessors: ["A SS+2"] }, { id: "C", name: "C", duration: 3, predecessors: ["B FF+1"] }, { id: "D", name: "D", duration: 2, predecessors: ["A"] }] });
    const x = byId(r.rows) as Record<string, ReturnType<typeof criticalPath>["rows"][number]>;
    expect(r.duration).toBe(9);
    expect([x.B.ES, x.B.EF, x.C.ES, x.C.EF, x.D.ES]).toEqual([2, 8, 6, 9, 4]);
    expect([x.A.totalFloat, x.B.totalFloat, x.C.totalFloat, x.D.totalFloat, x.D.freeFloat]).toEqual([0, 0, 0, 3, 3]);
  });
  it("parses link notation and rejects bad logic", () => {
    expect(parseLink("B SS+3")).toEqual({ id: "B", type: "SS", lag: 3 });
    expect(parseLink("1.2 ff - 1")).toEqual({ id: "1.2", type: "FF", lag: -1 });
    expect(parseLink("A")).toEqual({ id: "A", type: "FS", lag: 0 });
    expect(() => criticalPath({ activities: [{ id: "A", name: "A", duration: 1, predecessors: ["B"] }, { id: "B", name: "B", duration: 1, predecessors: ["A"] }] })).toThrow(/loop/);
    expect(() => criticalPath({ activities: [{ id: "A", name: "A", duration: 1, predecessors: ["Z"] }] })).toThrow(/does not exist/);
    expect(() => criticalPath({ activities: [{ id: "A", name: "A", duration: 1 }, { id: "A", name: "A2", duration: 1 }] })).toThrow(/Duplicate/);
  });
  it("working-day calendar: Bangladesh Friday weekend, holidays, US weekends", () => {
    // 2026-10-01 is a Thursday.
    const bd = workCalendar("2026-10-01", "fri", ["2026-10-05"]);
    expect([0, 1, 2, 3].map(bd.dateOf)).toEqual(["2026-10-01", "2026-10-03", "2026-10-04", "2026-10-06"]);
    const us = workCalendar("2026-10-01", "sat_sun");
    expect([0, 1, 2].map(us.dateOf)).toEqual(["2026-10-01", "2026-10-02", "2026-10-05"]);
    const gov = workCalendar("2026-10-02", "fri_sat"); // starts on a Friday → first working day Sunday
    expect(gov.dateOf(0)).toBe("2026-10-04");
  });
  it("calendar dates for activities and finish milestones", () => {
    const s = projectSchedule({ ...net, startDate: "2026-10-01", weekend: "sat_sun", activities: [...net.activities, { id: "M", name: "Handover", duration: 0, predecessors: ["H"] }] });
    const x = byId(s.rows) as Record<string, (typeof s.rows)[number]>;
    expect(x.A.start).toBe("2026-10-01");
    expect(x.A.finish).toBe("2026-10-05"); // Thu, Fri, Mon
    expect(x.M.start).toBe(x.H.finish); // milestone sits on the finish of its predecessor
    expect(s.finishDate).toBe(x.H.finish);
  });
});

describe("cost estimate", () => {
  const inp: EstimateInput = { project: "E", items: [{ description: "x", unit: "m3", quantity: 12.5, rate: 350, category: "Earth" }, { description: "y", unit: "kg", quantity: 100, rate: 115.5, category: "Steel" }, { description: "z", unit: "m3", quantity: 3, category: "Earth" }, { description: "w", unit: "m3", quantity: 2, rate: 14500, category: "Concrete" }], overheadPercent: 5, profitPercent: 10, contingencyPercent: 3, vatPercent: 7.5, otherTaxPercent: 2 };
  it("adds markups on the running total and taxes on the total before tax, rounded to 2 decimals per line", () => {
    const r = costEstimate(inp);
    expect(r.subtotal).toBe(44925); // 4375 + 11550 + 29000
    expect(r.overhead).toBe(2246.25);
    expect(r.profit).toBe(4717.13); // 10% of 47171.25
    expect(r.contingency).toBe(1556.65); // 3% of 51888.38 (rounded running total)
    expect(r.beforeTax).toBe(53445.03);
    expect(r.vat).toBe(4008.38);
    expect(r.otherTax).toBe(1068.9);
    expect(r.total).toBe(58522.31);
    expect(r.missingRates).toEqual(["3. z"]);
    expect(r.byCategory.find((c) => c.category === "Earth")?.amount).toBe(4375);
  });
  it("tool returns an Excel workbook and never fills missing rates", async () => {
    const out = await runTool("cost_estimate", inp);
    expect(out.error).toBeUndefined();
    expect(out.workbook?.sheets[0].name).toBe("Estimate");
    expect(out.summary).toMatch(/1 item\(s\) have no rate/);
  });
  it("routes cost and schedule questions to the new tools", () => {
    expect(selectToolsForText("prepare a cost estimate for this BOQ").map((t) => t.name)).toContain("cost_estimate");
    expect(selectToolsForText("make a gantt chart / construction schedule").map((t) => t.name)).toContain("project_schedule");
  });
});

describe("document extraction", () => {
  it("detects kinds", () => {
    expect(kindOf("Soil Report.PDF")).toBe("pdf");
    expect(kindOf("boq.xlsx")).toBe("xlsx");
    expect(kindOf("a.docx")).toBe("docx");
    expect(kindOf("rates.csv")).toBe("csv");
    expect(kindOf("x.exe")).toBeNull();
  });
  it("reads Excel (with formula results) and CSV", async () => {
    const buf = await buildWorkbook(estimateWorkbook({ project: "BOQ", items: [{ description: "RCC in footing", unit: "m3", quantity: 38, rate: 14500 }] }));
    const d = await extractDocument(buf, "boq.xlsx");
    expect(d.kind).toBe("xlsx");
    expect(d.sheets).toContain("Estimate");
    expect(d.text).toMatch(/RCC in footing \| m3 \| 38 \| 14500 \| 551000/);
    const c = await extractDocument(Buffer.from("Borehole,Depth m,SPT N\nBH-1,3,12\nBH-1,6,18\n"), "spt.csv");
    expect(c.text).toMatch(/BH-1 \| 3 \| 12/);
  });
  it("shortens very long documents and rejects unknown types", async () => {
    const d = await extractDocument(Buffer.from("x".repeat(50000)), "long.txt");
    expect(d.truncated).toBe(true);
    expect(d.chars).toBe(50000);
    await expect(extractDocument(Buffer.from("MZ"), "setup.exe")).rejects.toThrow(/Unsupported/);
  });
});

// ---------- Independent check with LibreOffice: formulas only (cached values stripped), recalculated on load ----------
const hasSoffice = (() => { try { execFileSync("soffice", ["--version"], { stdio: "ignore", timeout: 20000 }); return true; } catch { return false; } })();
const stripCached = (w: WorkbookSpec): WorkbookSpec => ({ ...w, sheets: w.sheets.map((s) => ({ ...s, rows: s.rows.map((r) => r.map((c) => (c && typeof c === "object" && "f" in c ? { f: c.f } : c))) })) });
function sofficeCsv(dir: string, files: string[]) {
  execFileSync("soffice", ["--headless", "--convert-to", "csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,true,false,false,false,-1", "--outdir", dir, ...files.map((f) => join(dir, f))], { stdio: "ignore", timeout: 180000 });
  const out: Record<string, string[][]> = {};
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".csv"))) out[f] = readFileSync(join(dir, f), "utf8").trim().split("\n").map((l) => l.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "")));
  return out;
}

describe.skipIf(!hasSoffice)("Excel formulas recalculated by LibreOffice match the engine", () => {
  const dir = mkdtempSync(join(tmpdir(), "civilmate-xlsx-"));
  const sched: ScheduleInput = { project: "T", startDate: "2026-10-01", weekend: "fri", holidays: ["2026-10-05"], activities: [
    { id: "A", name: "a", duration: 3 }, { id: "B", name: "b", duration: 4, predecessors: ["A"] }, { id: "C", name: "c", duration: 2, predecessors: ["A"] },
    { id: "D", name: "d", duration: 5, predecessors: ["B"] }, { id: "E", name: "e", duration: 1, predecessors: ["C"] }, { id: "F", name: "f", duration: 2, predecessors: ["C SS+1"] },
    { id: "G", name: "g", duration: 4, predecessors: ["D", "E FF+2"] }, { id: "H", name: "h", duration: 3, predecessors: ["F", "G SF+5"] }, { id: "M", name: "m", duration: 0, predecessors: ["H"] } ] };
  const est: EstimateInput = { project: "E", items: [{ description: "x", unit: "m3", quantity: 12.5, rate: 350, category: "Earth" }, { description: "y", unit: "kg", quantity: 100, rate: 115.5, category: "Steel" }, { description: "z", unit: "m3", quantity: 3, category: "Earth" }, { description: "w", unit: "m3", quantity: 2.333, rate: 14500, category: "Concrete" }], overheadPercent: 5, profitPercent: 10, contingencyPercent: 3, vatPercent: 7.5, otherTaxPercent: 2 };
  let csv: Record<string, string[][]> = {};
  it("builds and converts", async () => {
    writeFileSync(join(dir, "sched.xlsx"), await buildWorkbook(stripCached(scheduleWorkbook(sched))));
    writeFileSync(join(dir, "est.xlsx"), await buildWorkbook(stripCached(estimateWorkbook(est))));
    csv = sofficeCsv(dir, ["sched.xlsx", "est.xlsx"]);
    expect(Object.keys(csv)).toContain("sched-Schedule.csv");
  }, 200000);
  it("schedule: ES/EF/LS/LF, floats and dates", () => {
    const s = projectSchedule(sched);
    const rows = csv["sched-Schedule.csv"].filter((r) => s.rows.some((x) => x.id === r[0]));
    expect(rows.length).toBe(s.rows.length);
    const us = (iso?: string) => (iso ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}` : "");
    for (const r of s.rows) {
      const x = rows.find((y) => y[0] === r.id)!;
      expect([x[4], x[5], x[6], x[7], x[8], x[9]].map(Number), r.id).toEqual([r.ES, r.EF, r.LS, r.LF, r.totalFloat, r.freeFloat]);
      expect([x[11], x[12]], r.id).toEqual([us(r.start), us(r.finish)]);
    }
  });
  it("estimate: amounts, markups, taxes and category split", () => {
    const r = costEstimate(est);
    const sheet = csv["est-Estimate.csv"];
    const val = (label: string) => Number(sheet.find((x) => x[2] === label)![6]);
    expect(val("Subtotal (direct cost)")).toBeCloseTo(r.subtotal, 6);
    expect(val("Profit")).toBeCloseTo(r.profit, 6);
    expect(val("Contingency")).toBeCloseTo(r.contingency, 6);
    expect(val("Total before tax")).toBeCloseTo(r.beforeTax, 6);
    expect(val(`GRAND TOTAL (${r.currency})`)).toBeCloseTo(r.total, 6);
    const cat = csv["est-By category.csv"];
    for (const c of r.byCategory) expect(Number(cat.find((x) => x[0] === c.category)![1])).toBeCloseTo(c.amount, 6);
  });
});

describe.skipIf(!hasSoffice)("extraction of Word and PDF files made by LibreOffice", () => {
  it("reads docx and pdf text", async () => {
    const dir = mkdtempSync(join(tmpdir(), "civilmate-doc-"));
    writeFileSync(join(dir, "soil.txt"), "Subsoil investigation report\nBH-1: SPT N = 12 at 3.0 m; allowable bearing capacity 150 kPa at 1.5 m depth.\n");
    execFileSync("soffice", ["--headless", "--convert-to", "docx:MS Word 2007 XML", "--outdir", dir, join(dir, "soil.txt")], { stdio: "ignore", timeout: 120000 });
    execFileSync("soffice", ["--headless", "--convert-to", "pdf", "--outdir", dir, join(dir, "soil.txt")], { stdio: "ignore", timeout: 120000 });
    const docx = await extractDocument(readFileSync(join(dir, "soil.docx")), "soil.docx");
    expect(docx.text).toMatch(/SPT N = 12 at 3\.0 m/);
    const pdf = await extractDocument(readFileSync(join(dir, "soil.pdf")), "soil.pdf");
    expect(pdf.pages).toBe(1);
    expect(pdf.text).toMatch(/150 kPa/);
    expect(pdf.warning).toBeUndefined();
  }, 200000);
});
