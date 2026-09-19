/**
 * Project schedule by the critical path method (precedence diagram): forward and backward pass with FS/SS/FF/SF links
 * and lags, total and free float, critical path, and calendar dates on a working-day calendar (weekends + holidays).
 * Durations are in working days and come from the user; they are never invented.
 * The Excel export keeps ES/EF/LS/LF, floats and dates as live formulas (WORKDAY.INTL), with a Gantt chart sheet.
 */
import { sheetRow, type CellSpec, type SheetSpec, type WorkbookSpec } from "@/lib/docs/workbook";

export type LinkType = "FS" | "SS" | "FF" | "SF";
export interface Link { id: string; type?: LinkType; lag?: number }
export interface Activity { id: string; name: string; duration: number; predecessors?: (string | Link)[]; resource?: string; cost?: number }
/** Weekly days off: Bangladesh private sector Friday; government Friday + Saturday; USA Saturday + Sunday. */
export type WeekPattern = "fri" | "fri_sat" | "sat_sun" | "none";
export interface ScheduleInput { project?: string; activities: Activity[]; startDate?: string; weekend?: WeekPattern; holidays?: string[] }

// Excel WORKDAY.INTL weekend strings, Monday first, "1" = day off.
const WEEKEND_CODE: Record<WeekPattern, string> = { fri: "0000100", fri_sat: "0000110", sat_sun: "0000011", none: "0000000" };
const WEEKEND_DAYS: Record<WeekPattern, number[]> = { fri: [5], fri_sat: [5, 6], sat_sun: [6, 0], none: [] }; // JS getUTCDay()

/** Parse "A", "A+2", "A SS", "A SS+3", "A FF-1" into a link. */
export function parseLink(p: string | Link): Link {
  if (typeof p !== "string") return { id: p.id.trim(), type: p.type ?? "FS", lag: p.lag ?? 0 };
  const m = p.trim().match(/^(.+?)\s*(FS|SS|FF|SF)?\s*([+-]\s*\d+(?:\.\d+)?)?$/i);
  if (!m) return { id: p.trim(), type: "FS", lag: 0 };
  return { id: m[1].trim(), type: ((m[2] ?? "FS").toUpperCase() as LinkType), lag: m[3] ? Number(m[3].replace(/\s/g, "")) : 0 };
}
const linkLabel = (l: Link) => `${l.id}${l.type !== "FS" ? ` ${l.type}` : ""}${l.lag ? (l.lag > 0 ? `+${l.lag}` : `${l.lag}`) : ""}`;

export function criticalPath(inp: ScheduleInput) {
  const acts = inp.activities;
  if (!acts?.length) throw new Error("Give at least one activity (id, name, duration in working days)");
  const byId = new Map<string, number>();
  acts.forEach((a, i) => {
    const id = String(a.id).trim();
    if (!id) throw new Error(`Activity ${i + 1} has no id`);
    if (byId.has(id)) throw new Error(`Duplicate activity id "${id}"`);
    if (!(a.duration >= 0)) throw new Error(`Activity ${id}: duration must be 0 or more working days`);
    byId.set(id, i);
  });
  const preds = acts.map((a) => (a.predecessors ?? []).map(parseLink).map((l) => {
    const j = byId.get(l.id);
    if (j === undefined) throw new Error(`Activity ${a.id}: predecessor "${l.id}" does not exist`);
    return { ...l, j };
  }));
  // Topological order (Kahn); a leftover means a loop.
  const n = acts.length, indeg = preds.map((p) => p.length), succ: { i: number; type: LinkType; lag: number }[][] = acts.map(() => []);
  preds.forEach((ps, i) => ps.forEach((l) => succ[l.j].push({ i, type: l.type!, lag: l.lag! })));
  const order: number[] = [], queue = indeg.flatMap((d, i) => (d === 0 ? [i] : []));
  while (queue.length) { const i = queue.shift()!; order.push(i); for (const s of succ[i]) if (--indeg[s.i] === 0) queue.push(s.i); }
  if (order.length < n) throw new Error(`The logic has a loop involving: ${acts.filter((_, i) => indeg[i] > 0).map((a) => a.id).join(", ")}`);

  const d = acts.map((a) => a.duration);
  const ES = new Array<number>(n).fill(0), EF = new Array<number>(n).fill(0);
  for (const i of order) {
    let es = 0;
    for (const l of preds[i]) {
      const p = l.j, lag = l.lag!;
      es = Math.max(es, l.type === "FS" ? EF[p] + lag : l.type === "SS" ? ES[p] + lag : l.type === "FF" ? EF[p] + lag - d[i] : ES[p] + lag - d[i]);
    }
    ES[i] = es; EF[i] = es + d[i];
  }
  const duration = Math.max(...EF);
  const LS = new Array<number>(n), LF = new Array<number>(n), FF = new Array<number>(n);
  for (const i of [...order].reverse()) {
    let lf = duration, ff = duration - EF[i];
    for (const s of succ[i]) {
      const j = s.i, lag = s.lag;
      lf = Math.min(lf, s.type === "FS" ? LS[j] - lag : s.type === "SS" ? LS[j] - lag + d[i] : s.type === "FF" ? LF[j] - lag : LF[j] - lag + d[i]);
      ff = Math.min(ff, s.type === "FS" ? ES[j] - lag - EF[i] : s.type === "SS" ? ES[j] - lag - ES[i] : s.type === "FF" ? EF[j] - lag - EF[i] : EF[j] - lag - ES[i]);
    }
    LF[i] = lf; LS[i] = lf - d[i]; FF[i] = Math.max(0, ff);
  }
  const rows = acts.map((a, i) => {
    const tf = LS[i] - ES[i];
    return { id: String(a.id).trim(), name: a.name, duration: d[i], predecessors: preds[i].map(linkLabel), ES: ES[i], EF: EF[i], LS: LS[i], LF: LF[i], totalFloat: tf, freeFloat: FF[i], critical: Math.abs(tf) < 1e-9, resource: a.resource, cost: a.cost };
  });
  // Critical path(s): chains of zero-float activities joined by driving links, in schedule order.
  const critical = order.filter((i) => rows[i].critical).map((i) => rows[i].id);
  return { project: inp.project ?? "Project schedule", duration, rows, order: order.map((i) => rows[i].id), critical };
}

const dayMs = 86400000;
const toISO = (t: number) => new Date(t).toISOString().slice(0, 10);
const excelSerial = (iso: string) => (Date.parse(`${iso}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / dayMs;

/** Working-day calendar: day index k (0-based) → date. Index 0 is the first working day on or after the start date. */
export function workCalendar(startDate: string, weekend: WeekPattern = "fri", holidays: string[] = []) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || Number.isNaN(Date.parse(startDate))) throw new Error("startDate must be YYYY-MM-DD");
  const off = new Set(WEEKEND_DAYS[weekend]), hol = new Set(holidays);
  const isWork = (t: number) => !off.has(new Date(t).getUTCDay()) && !hol.has(toISO(t));
  const cache: number[] = [];
  let t = Date.parse(`${startDate}T00:00:00Z`);
  const dateOf = (k: number) => {
    while (cache.length <= k) { while (!isWork(t)) t += dayMs; cache.push(t); t += dayMs; }
    return toISO(cache[k]);
  };
  return { dateOf, weekendCode: WEEKEND_CODE[weekend], workDaysPerWeek: 7 - off.size };
}

export function projectSchedule(inp: ScheduleInput) {
  const cpm = criticalPath(inp);
  const cal = inp.startDate ? workCalendar(inp.startDate, inp.weekend ?? "fri", inp.holidays) : null;
  // A milestone (0 days) takes the date of the working day it follows, like a finish milestone in MS Project.
  const rows = cpm.rows.map((r) => {
    const start = cal?.dateOf(r.duration > 0 ? r.ES : Math.max(0, r.ES - 1));
    return { ...r, start, finish: cal ? (r.duration > 0 ? cal.dateOf(r.EF - 1) : start) : undefined };
  });
  const finishDate = cal ? cal.dateOf(Math.max(0, cpm.duration - 1)) : undefined;
  const totalCost = rows.some((r) => r.cost !== undefined) ? rows.reduce((s, r) => s + (r.cost ?? 0), 0) : undefined;
  return { ...cpm, rows, startDate: cal ? cal.dateOf(0) : undefined, finishDate, weekend: inp.weekend ?? "fri", totalCost };
}

/** Workbook: Schedule sheet with live CPM formulas, Calendar sheet (start date, weekend code, holidays), Gantt chart. */
export function scheduleWorkbook(inp: ScheduleInput): WorkbookSpec {
  const s = projectSchedule(inp);
  const n = s.rows.length;
  const idx = new Map(s.rows.map((r, i) => [r.id, i]));
  const sched: Omit<SheetSpec, "rows"> = { name: "Schedule", title: `${s.project}: CPM schedule (${s.duration} working days${s.finishDate ? `, ${s.startDate} to ${s.finishDate}` : ""})`, columns: [] };
  const R = (i: number) => sheetRow(sched, i);
  // Columns: A ID, B Activity, C Duration, D Predecessors, E ES, F EF, G LS, H LF, I Total float, J Free float, K Critical, L Start, M Finish, N Resource, O Cost
  const links = inp.activities.map((a) => (a.predecessors ?? []).map(parseLink));
  const succOf = s.rows.map(() => [] as { i: number; type: LinkType; lag: number }[]);
  links.forEach((ls, i) => ls.forEach((l) => succOf[idx.get(l.id)!].push({ i, type: l.type!, lag: l.lag! })));
  const hasCal = !!s.startDate;
  const calRef = { start: "Calendar!$B$1", code: "Calendar!$B$2", hol: "Calendar!$D$2:$D$200" };
  const lagS = (lag: number) => (lag ? (lag > 0 ? `+${lag}` : `${lag}`) : "");
  const rows: CellSpec[][] = s.rows.map((r, i) => {
    const me = R(i);
    const es = links[i].map((l) => { const p = R(idx.get(l.id)!); return l.type === "FS" ? `F${p}${lagS(l.lag!)}` : l.type === "SS" ? `E${p}${lagS(l.lag!)}` : l.type === "FF" ? `F${p}${lagS(l.lag!)}-C${me}` : `E${p}${lagS(l.lag!)}-C${me}`; });
    const lf = succOf[i].map((x) => { const q = R(x.i), neg = lagS(-x.lag); return x.type === "FS" ? `G${q}${neg}` : x.type === "SS" ? `G${q}${neg}+C${me}` : x.type === "FF" ? `H${q}${neg}` : `H${q}${neg}+C${me}`; });
    const ffTerms = succOf[i].map((x) => { const q = R(x.i), neg = lagS(-x.lag); return x.type === "FS" ? `E${q}${neg}-F${me}` : x.type === "SS" ? `E${q}${neg}-E${me}` : x.type === "FF" ? `F${q}${neg}-F${me}` : `F${q}${neg}-E${me}`; });
    const projEnd = `MAX($F$${R(0)}:$F$${R(n - 1)})`;
    return [
      r.id, r.name, r.duration, r.predecessors.join(", "),
      { f: es.length ? `MAX(0,${es.join(",")})` : "0", v: r.ES },
      { f: `E${me}+C${me}`, v: r.EF },
      { f: `H${me}-C${me}`, v: r.LS },
      { f: lf.length ? `MIN(${projEnd},${lf.join(",")})` : projEnd, v: r.LF },
      { f: `G${me}-E${me}`, v: r.totalFloat },
      { f: `MAX(0,MIN(${[`${projEnd}-F${me}`, ...ffTerms].join(",")}))`, v: r.freeFloat },
      { f: `IF(I${me}=0,"YES","")`, v: r.critical ? "YES" : "" },
      hasCal ? { f: `IF(C${me}=0,WORKDAY.INTL(${calRef.start}-1,MAX(1,E${me}),${calRef.code},${calRef.hol}),WORKDAY.INTL(${calRef.start}-1,E${me}+1,${calRef.code},${calRef.hol}))`, v: excelSerial(r.start!) } : "",
      hasCal ? { f: `IF(C${me}=0,L${me},WORKDAY.INTL(${calRef.start}-1,F${me},${calRef.code},${calRef.hol}))`, v: excelSerial(r.finish!) } : "",
      r.resource ?? "", r.cost ?? null,
    ];
  });
  rows.push([]);
  rows.push(["", "Project duration (working days)", { f: `MAX(F${R(0)}:F${R(n - 1)})`, v: s.duration }]);
  if (s.totalCost !== undefined) rows.push(["", "Total cost", "", "", "", "", "", "", "", "", "", "", "", "", { f: `SUM(O${R(0)}:O${R(n - 1)})`, v: s.totalCost }]);
  const date = "dd-mmm-yyyy";
  const sheets: SheetSpec[] = [{
    ...sched,
    columns: [{ header: "ID", width: 8 }, { header: "Activity", width: 36 }, { header: "Duration (days)", width: 10 }, { header: "Predecessors", width: 16 }, { header: "ES", width: 6 }, { header: "EF", width: 6 }, { header: "LS", width: 6 }, { header: "LF", width: 6 }, { header: "Total float", width: 8 }, { header: "Free float", width: 8 }, { header: "Critical", width: 8 }, { header: "Start", width: 13, numFmt: date }, { header: "Finish", width: 13, numFmt: date }, { header: "Resource", width: 14 }, { header: "Cost", width: 14, numFmt: "#,##0.00" }],
    rows, boldRows: [n + 2], freeze: { row: 0, col: 2 },
    fills: s.rows.flatMap((r, i) => (r.critical ? [[i + 1, 1, 2, "FFFDE2E2"] as [number, number, number, string]] : [])),
    notes: [
      "ES/EF/LS/LF are working-day numbers from the project start (day 0). Durations and links are formulas: change a duration and Excel recalculates floats and dates.",
      "Links: FS finish-to-start (default), SS start-to-start, FF finish-to-finish, SF start-to-finish; +n / -n is a lag in working days. If you add or remove links, re-create the schedule in CivilMate.",
      "Critical activities (zero total float) are shaded. Prepared with CivilMate; durations are as given by the user.",
    ],
  }];
  if (hasCal) {
    const hol = [...new Set(inp.holidays ?? [])].sort();
    sheets.push({ name: "Calendar", rows: [["Project start", { date: inp.startDate! }, "", "Holidays"], ["Weekend code (WORKDAY.INTL)", WEEKEND_CODE[s.weekend], "", ...(hol[0] ? [{ date: hol[0] }] : [])], ...hol.slice(1).map((h): CellSpec[] => ["", "", "", { date: h }]), [], ["Weekend code: 7 digits Monday→Sunday, 1 = day off. 0000100 Friday off (Bangladesh), 0000110 Friday + Saturday, 0000011 Saturday + Sunday (USA)."]] });
  }
  sheets.push(ganttSheet(s));
  return { title: s.project, sheets };
}

/** Gantt chart: one column per working day (≤ 120 days), per week (≤ 120 weeks) or per 4 weeks; critical bars red. */
function ganttSheet(s: ReturnType<typeof projectSchedule>): SheetSpec {
  const cal = s.startDate ? workCalendar(s.startDate, s.weekend, []) : null;
  const perWeek = cal?.workDaysPerWeek ?? 6;
  const step = s.duration <= 120 ? 1 : s.duration <= 120 * perWeek ? perWeek : 4 * perWeek;
  const periods = Math.max(1, Math.ceil(s.duration / step));
  const unit = step === 1 ? "day" : step === perWeek ? "week" : "4 weeks";
  // Header: date of the period's first working day (MM-DD for days, YY-MM-DD otherwise), or D1/W1/P1 without a start date.
  const label = (p: number) => (cal ? cal.dateOf(p * step).slice(step === 1 ? 5 : 2) : `${unit === "day" ? "D" : unit === "week" ? "W" : "P"}${p + 1}`);
  const fills: [number, number, number, string][] = [];
  const rows: CellSpec[][] = s.rows.map((r, i) => {
    const a = Math.floor(r.ES / step), b = r.duration > 0 ? Math.floor((r.EF - 1) / step) : a;
    fills.push([i + 1, 4 + a, 4 + b, r.critical ? "FFE53935" : "FF42A5F5"]);
    return [r.id, r.name, r.duration, ...new Array(periods).fill("")];
  });
  return {
    name: "Gantt", title: `Gantt chart (one column = ${unit === "day" ? "1 working day" : unit === "week" ? `1 week of ${perWeek} working days` : `4 weeks`}; red = critical)`,
    columns: [{ header: "ID", width: 8 }, { header: "Activity", width: 32 }, { header: "Days", width: 6 }, ...Array.from({ length: periods }, (_, p) => ({ header: label(p), width: step === 1 ? 5.5 : 7 }))],
    rows, fills, freeze: { row: 0, col: 3 },
    notes: ["Bars show the early-start schedule at the time of export."],
  };
}
