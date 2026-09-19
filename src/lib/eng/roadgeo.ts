/**
 * Road geometric design: horizontal curves (elements, chainage, setting out), minimum radius and superelevation,
 * sight distance, crest/sag vertical curves and the Bangladesh RHD/LGED cross-sections.
 * Units: "SI" = km/h and m; "US" = mph and ft. Grades are in percent (+ up, − down).
 *
 * Sources (values read from the documents; where a standard publishes nothing the notes say which one is borrowed):
 *  - AASHTO "A Policy on Geometric Design of Highways and Streets" (Green Book). Metric values as reproduced in
 *    NYSDOT Highway Design Manual Ch. 2 App. A (Exhibits M2-12 to M2-14) and Indiana DOT Design Manual Ch. 43
 *    (Eq. 43-3.1 to 43-3.3, Figs. 43-3A to 43-3G) and Ch. 44; US customary Rmin/Method 5 values checked against the
 *    TxDOT Roadway Design Manual Tables 4-6 and 4-7.
 *    R = V²/(127(e + f)) [SI], V²/(15(0.01e + f)) [US, e in %]; SSD = 0.278Vt + 0.039V²/a [SI], 1.47Vt + 1.075V²/a [US];
 *    crest L = AS²/658 (SI, h1 1.08 m, h2 0.60 m) or AS²/2158 (US, 3.5 ft/2.0 ft); sag L = AS²/(120 + 3.5S) [SI],
 *    AS²/(400 + 3.5S) [US]; superelevation distributed by Method 5; runoff Lr = w·n1·e·bw/Δ.
 *  - RHD "Geometric Design Standards for RHD" (Roads & Highways Department, Bangladesh), Draft v4, Oct 2000:
 *    Tables 2.1–2.3 (design types, speeds, sight distances), 5.1–5.4 (radii, superelevation, transitions, widening),
 *    6.1–6.3 (K values, appearance, gradients), Secs. 4.6–4.7 (clearances, crossfall), 5.3–5.5, 6.3.
 *  - LGED "Road Design Standards – Rural Roads" (Local Government Engineering Department, Bangladesh, 2005):
 *    Tables 3–7 (traffic, cross-sections, gradients, no-superelevation radius, extra width) and pp. 10–12 (transition,
 *    superelevation, camber).
 *  - IRC:66, IRC:73 and IRC:SP:23 (Indian Roads Congress) as presented in NPTEL "Introduction to Transportation
 *    Engineering" (Tom Mathew & K V Krishna Rao, IIT Bombay), Chs. 13–18: SSD = vt + v²/(2g(f ± n)),
 *    e = V²/(225R) ≤ 0.07 with f ≤ 0.15, crest L = NS²/4.4 (SSD) or NS²/9.6 (ISD/OSD), sag L = NS²/(1.5 + 0.035S),
 *    sag comfort L = 2(N·v³/C)^½ with C = 0.6 m/s³. Bangladesh practice often borrows these where RHD/LGED are silent.
 */

export type Units = "SI" | "US";
export type RoadStandard = "AASHTO" | "RHD" | "LGED" | "IRC";
export interface Check { name: string; ok: boolean; detail: string }

export const SOURCES: Record<RoadStandard, string> = {
  AASHTO: "AASHTO Green Book (metric values per NYSDOT HDM Ch. 2 App. A and Indiana DOT DM Ch. 43–44; US values per TxDOT RDM Tables 4-6/4-7)",
  RHD: "RHD Geometric Design Standards, Draft v4, Oct 2000 (Bangladesh Roads & Highways Department)",
  LGED: "LGED Road Design Standards – Rural Roads, 2005 (Bangladesh)",
  IRC: "IRC:66 / IRC:73 / IRC:SP:23 (Indian Roads Congress), as presented in NPTEL Introduction to Transportation Engineering Chs. 13–18",
};

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const G_SI = 9.81;
/** R = V²/(C(e + f)) with e and f as decimals: C = 127 (km/h, m) or 15 (mph, ft). */
export const radiusConstant = (u: Units) => (u === "US" ? 15 : 127);
export const speedUnit = (u: Units) => (u === "US" ? "mph" : "km/h");
export const lengthUnit = (u: Units) => (u === "US" ? "ft" : "m");
const f1 = (x: number) => x.toFixed(1);
const f2 = (x: number) => x.toFixed(2);
const f3 = (x: number) => x.toFixed(3);
const pct = (x: number, d = 2) => `${(x * 100).toFixed(d)}%`;
/** Round up to a multiple of step (tolerant of floating-point noise). */
export const ceilTo = (x: number, step: number) => Math.ceil(x / step - 1e-9) * step;

function need(cond: boolean, msg: string): void { if (!cond) throw new Error(msg); }
const positive = (x: number | undefined, name: string) => need(x !== undefined && Number.isFinite(x) && x > 0, `${name} must be a positive number`);

/** Linear interpolation in a table sorted by x; returns the value and whether x was a tabulated point. */
export function interpTable(table: readonly (readonly [number, number])[], x: number): { value: number; exact: boolean; inRange: boolean } {
  const lo = table[0][0], hi = table[table.length - 1][0];
  if (x < lo - 1e-9 || x > hi + 1e-9) return { value: x < lo ? table[0][1] : table[table.length - 1][1], exact: false, inRange: false };
  for (let i = 0; i < table.length; i++) if (Math.abs(table[i][0] - x) < 1e-9) return { value: table[i][1], exact: true, inRange: true };
  for (let i = 0; i < table.length - 1; i++) {
    const [x0, y0] = table[i], [x1, y1] = table[i + 1];
    if (x > x0 && x < x1) return { value: y0 + ((x - x0) / (x1 - x0)) * (y1 - y0), exact: false, inRange: true };
  }
  return { value: table[table.length - 1][1], exact: false, inRange: true };
}

// ---------------- Chainage / stations ----------------

/**
 * Format a running distance: SI chainage in km + m ("3+104.41"), US stations of 100 ft ("199+48.00").
 * Negative values get a leading minus.
 */
export function formatChainage(x: number, units: Units = "SI", decimals = 2): string {
  const base = units === "US" ? 100 : 1000;
  const width = units === "US" ? 2 : 3;
  const p = 10 ** decimals;
  const r = Math.round(Math.abs(x) * p) / p;
  const major = Math.floor(r / base + 1e-12);
  const minor = r - major * base;
  const minorStr = minor.toFixed(decimals).padStart(width + (decimals > 0 ? decimals + 1 : 0), "0");
  return `${x < 0 ? "-" : ""}${major}+${minorStr}`;
}

/** Parse "3+104.4" (SI, km+m) or "199+48" (US, 100-ft stations) or a plain number into a running distance. */
export function parseChainage(s: string | number, units: Units = "SI"): number {
  if (typeof s === "number") return s;
  const t = s.trim().replace(/\s+/g, "");
  const m = /^(-?)(\d+)\+(\d+(?:\.\d+)?)$/.exec(t);
  if (m) return (m[1] ? -1 : 1) * (Number(m[2]) * (units === "US" ? 100 : 1000) + Number(m[3]));
  const v = Number(t);
  need(Number.isFinite(v), `Cannot read chainage "${s}"`);
  return v;
}

/** Degrees → 12°34′56″ (whole seconds, with carry). */
export function formatDMS(d: number): string {
  const sign = d < 0 ? "-" : "";
  let s = Math.round(Math.abs(d) * 3600);
  const dd = Math.floor(s / 3600); s -= dd * 3600;
  const mm = Math.floor(s / 60); s -= mm * 60;
  return `${sign}${dd}°${String(mm).padStart(2, "0")}′${String(s).padStart(2, "0")}″`;
}

// ---------------- Horizontal (circular) curve ----------------

/** Circular curve elements (unit-independent): T = R tan(Δ/2), L = πRΔ/180, E = R[sec(Δ/2) − 1], M = R[1 − cos(Δ/2)], LC = 2R sin(Δ/2). */
export function curveElements(R: number, deltaDeg: number) {
  positive(R, "Radius");
  need(deltaDeg > 0 && deltaDeg < 180, "Deflection angle Δ must be between 0° and 180°");
  const h = rad(deltaDeg / 2);
  return { R, delta: deltaDeg, T: R * Math.tan(h), L: (Math.PI * R * deltaDeg) / 180, E: R * (1 / Math.cos(h) - 1), M: R * (1 - Math.cos(h)), LC: 2 * R * Math.sin(h) };
}
/** Δ (degrees) from radius and tangent length: Δ = 2·atan(T/R). */
export const deltaFromTangent = (R: number, T: number) => 2 * deg(Math.atan(T / R));
/** R from external distance and Δ: R = E / (sec(Δ/2) − 1). */
export const radiusFromExternal = (E: number, deltaDeg: number) => E / (1 / Math.cos(rad(deltaDeg / 2)) - 1);
/** R from tangent length and Δ: R = T / tan(Δ/2). */
export const radiusFromTangent = (T: number, deltaDeg: number) => T / Math.tan(rad(deltaDeg / 2));
/** R from middle ordinate and Δ: R = M / (1 − cos(Δ/2)). */
export const radiusFromMiddleOrdinate = (M: number, deltaDeg: number) => M / (1 - Math.cos(rad(deltaDeg / 2)));
/** R from long chord and Δ: R = LC / (2 sin(Δ/2)). */
export const radiusFromLongChord = (LC: number, deltaDeg: number) => LC / (2 * Math.sin(rad(deltaDeg / 2)));
/** R from arc length and Δ: R = 180L/(πΔ). */
export const radiusFromLength = (L: number, deltaDeg: number) => (180 * L) / (Math.PI * deltaDeg);
/** US arc-definition degree of curve (100-ft arc): R = 18000/(πD) = 5729.58/D ft. */
export const radiusFromDegreeOfCurve = (D: number) => 18000 / (Math.PI * D);

export interface SetOutRow { point: string; chainage: number; label: string; arc: number; chord: number; deflection: number; totalDeflection: number; chordFromPC: number }

/**
 * Setting out by deflection angles (Rankine's method) from the PC: first sub-chord to the next round chainage, full chords
 * of `interval`, last sub-chord to the PT. δ = 1718.87·c/R minutes (= 90c/(πR) degrees), chord = 2R·sin δ; total
 * deflections are cumulative and end at Δ/2. chordFromPC = 2R·sin(total deflection) for setting out from the PC.
 */
export function deflectionTable(R: number, deltaDeg: number, pcChainage: number, interval: number, units: Units = "SI"): SetOutRow[] {
  positive(R, "Radius"); positive(interval, "Chord interval");
  const L = (Math.PI * R * deltaDeg) / 180;
  need(L / interval <= 2000, `Chord interval ${interval} gives more than 2000 points on a ${f1(L)} curve; use a larger interval`);
  const pt = pcChainage + L;
  const pts: number[] = [];
  let next = Math.ceil(pcChainage / interval - 1e-9) * interval;
  if (next <= pcChainage + 1e-9) next += interval;
  for (let c = next; c < pt - 1e-6; c += interval) pts.push(c);
  pts.push(pt);
  const rows: SetOutRow[] = [];
  let prev = pcChainage, total = 0;
  pts.forEach((ch, i) => {
    const arc = ch - prev;
    const d = (90 * arc) / (Math.PI * R);
    total += d;
    rows.push({ point: i === pts.length - 1 ? "PT" : `${i + 1}`, chainage: ch, label: formatChainage(ch, units), arc, chord: 2 * R * Math.sin(rad(d)), deflection: d, totalDeflection: total, chordFromPC: 2 * R * Math.sin(rad(total)) });
    prev = ch;
  });
  return rows;
}

export interface HorizontalCurveInput {
  units?: Units;
  radius?: number;
  deflectionAngle?: number; // Δ, decimal degrees
  tangentLength?: number;
  externalDistance?: number;
  middleOrdinate?: number;
  longChord?: number;
  curveLength?: number;
  degreeOfCurve?: number; // US arc definition (100-ft arc)
  piChainage?: number; // running distance of the PI (m or ft)
  chordInterval?: number; // default 20 m or 100 ft
}

/** Solve a simple circular curve from any sufficient pair of inputs, then chainages and the deflection-angle table. */
export function horizontalCurve(inp: HorizontalCurveInput) {
  const u = inp.units ?? "SI";
  const lu = lengthUnit(u);
  const steps: string[] = [];
  const checks: Check[] = [];
  const notes: string[] = [];
  for (const [k, v] of Object.entries(inp)) if (typeof v === "number") need(Number.isFinite(v), `${k} must be a number`);
  for (const k of ["radius", "tangentLength", "externalDistance", "middleOrdinate", "longChord", "curveLength", "degreeOfCurve", "chordInterval"] as const) if (inp[k] !== undefined) positive(inp[k], k);

  let R = inp.radius;
  let D = inp.deflectionAngle;
  if (R === undefined && inp.degreeOfCurve !== undefined) {
    need(u === "US", "Degree of curve is the US 100-ft arc definition; for SI give the radius");
    R = radiusFromDegreeOfCurve(inp.degreeOfCurve);
    steps.push(`R = 5729.58 / D = 5729.58 / ${inp.degreeOfCurve} = ${f2(R)} ft (arc definition, 100-ft arc)`);
  }
  let solvedFrom = "R and Δ";
  if (R !== undefined && D === undefined) {
    if (inp.tangentLength !== undefined) { D = deltaFromTangent(R, inp.tangentLength); solvedFrom = "R and T"; steps.push(`Δ = 2·atan(T/R) = 2·atan(${inp.tangentLength}/${R}) = ${f3(D)}° (${formatDMS(D)})`); }
    else if (inp.curveLength !== undefined) { D = (180 * inp.curveLength) / (Math.PI * R); solvedFrom = "R and L"; steps.push(`Δ = 180L/(πR) = 180×${inp.curveLength}/(π×${R}) = ${f3(D)}°`); }
    else if (inp.longChord !== undefined) { need(inp.longChord <= 2 * R, "Long chord cannot exceed 2R"); D = 2 * deg(Math.asin(inp.longChord / (2 * R))); solvedFrom = "R and LC"; steps.push(`Δ = 2·asin(LC/2R) = ${f3(D)}°`); }
    else if (inp.externalDistance !== undefined) { D = 2 * deg(Math.acos(R / (R + inp.externalDistance))); solvedFrom = "R and E"; steps.push(`Δ = 2·acos(R/(R + E)) = ${f3(D)}°`); }
    else if (inp.middleOrdinate !== undefined) { need(inp.middleOrdinate < R, "Middle ordinate must be less than R"); D = 2 * deg(Math.acos(1 - inp.middleOrdinate / R)); solvedFrom = "R and M"; steps.push(`Δ = 2·acos(1 − M/R) = ${f3(D)}°`); }
  } else if (R === undefined && D !== undefined) {
    need(D > 0 && D < 180, "Deflection angle Δ must be between 0° and 180°");
    const h = `Δ/2 = ${f3(D / 2)}°`;
    if (inp.tangentLength !== undefined) { R = radiusFromTangent(inp.tangentLength, D); solvedFrom = "T and Δ"; steps.push(`R = T / tan(Δ/2) = ${inp.tangentLength} / tan(${f3(D / 2)}°) = ${f2(R)} ${lu}`); }
    else if (inp.externalDistance !== undefined) { R = radiusFromExternal(inp.externalDistance, D); solvedFrom = "E and Δ"; steps.push(`R = E / (sec(Δ/2) − 1) = ${inp.externalDistance} / (sec ${f3(D / 2)}° − 1) = ${inp.externalDistance} / ${(1 / Math.cos(rad(D / 2)) - 1).toFixed(6)} = ${f2(R)} ${lu}`); }
    else if (inp.middleOrdinate !== undefined) { R = radiusFromMiddleOrdinate(inp.middleOrdinate, D); solvedFrom = "M and Δ"; steps.push(`R = M / (1 − cos(Δ/2)), ${h}: R = ${f2(R)} ${lu}`); }
    else if (inp.longChord !== undefined) { R = radiusFromLongChord(inp.longChord, D); solvedFrom = "LC and Δ"; steps.push(`R = LC / (2 sin(Δ/2)), ${h}: R = ${f2(R)} ${lu}`); }
    else if (inp.curveLength !== undefined) { R = radiusFromLength(inp.curveLength, D); solvedFrom = "L and Δ"; steps.push(`R = 180L/(πΔ) = ${f2(R)} ${lu}`); }
  }
  need(R !== undefined && D !== undefined, "Give the radius (or US degree of curve) and the deflection angle Δ, or one of them together with T, E, M, LC or L");
  const el = curveElements(R!, D!);
  steps.push(
    `T = R·tan(Δ/2) = ${f2(el.R)}·tan(${f3(el.delta / 2)}°) = ${f2(el.T)} ${lu}`,
    `L = πRΔ/180 = π×${f2(el.R)}×${f3(el.delta)}/180 = ${f2(el.L)} ${lu}`,
    `E = R[sec(Δ/2) − 1] = ${f2(el.E)} ${lu}; M = R[1 − cos(Δ/2)] = ${f2(el.M)} ${lu}; LC = 2R·sin(Δ/2) = ${f2(el.LC)} ${lu}`,
  );
  // Given-but-unused values must agree with the solution.
  const given: [keyof HorizontalCurveInput, number, string][] = [["tangentLength", el.T, "T"], ["externalDistance", el.E, "E"], ["middleOrdinate", el.M, "M"], ["longChord", el.LC, "LC"], ["curveLength", el.L, "L"]];
  for (const [k, v, n] of given) {
    const g = inp[k] as number | undefined;
    if (g !== undefined && Math.abs(g - v) / v > 0.002) checks.push({ name: `Given ${n} is consistent`, ok: false, detail: `given ${n} = ${g} but R and Δ give ${f2(v)} ${lu}` });
  }
  const interval = inp.chordInterval ?? (u === "US" ? 100 : 20);
  const pi = inp.piChainage;
  const pc = pi !== undefined ? pi - el.T : 0;
  const pt = pc + el.L;
  if (pi !== undefined) {
    steps.push(
      `PC = PI − T = ${f2(pi)} − ${f2(el.T)} = ${f2(pc)} (${formatChainage(pc, u)})`,
      `PT = PC + L = ${f2(pc)} + ${f2(el.L)} = ${f2(pt)} (${formatChainage(pt, u)}); not PI + T = ${f2(pi + el.T)}, because the route is measured along the curve`,
    );
  } else notes.push("No PI chainage given: the setting-out table starts with PC at 0+000.");
  const table = deflectionTable(el.R, el.delta, pc, interval, u);
  const last = table[table.length - 1];
  steps.push(
    `Setting out from PC by deflection angles: δ = 1718.87·c/R minutes, chord = 2R·sin δ; chord interval ${interval} ${lu}; first sub-chord ${f2(table[0].arc)} ${lu}, last sub-chord ${f2(last.arc)} ${lu}`,
    ...table.slice(0, 60).map((r) => `${r.point} at ${r.label}: arc ${f2(r.arc)}, chord ${f3(r.chord)} ${lu}, δ ${formatDMS(r.deflection)}, total ${formatDMS(r.totalDeflection)}`),
  );
  if (table.length > 60) steps.push(`… ${table.length - 60} more points in the table (result.settingOut)`);
  checks.push({ name: "Total deflection = Δ/2", ok: Math.abs(last.totalDeflection - el.delta / 2) < 1e-6, detail: `${formatDMS(last.totalDeflection)} vs Δ/2 = ${formatDMS(el.delta / 2)}` });
  notes.push("Curve elements are unit-independent (R, T, L, E, M, LC all in the same length unit). Chainage format: SI km+m (3+104.41), US 100-ft stations (199+48.00).");
  return {
    units: u, solvedFrom, ...el, degreeOfCurve: u === "US" ? 18000 / (Math.PI * el.R) : undefined,
    pi, pc, pt, piLabel: pi !== undefined ? formatChainage(pi, u) : undefined, pcLabel: formatChainage(pc, u), ptLabel: formatChainage(pt, u),
    chordInterval: interval, settingOut: table, steps, checks, notes,
  };
}

// ---------------- Radius and superelevation ----------------

/** AASHTO maximum side friction fmax, open-road conditions (Green Book Table 3-7). SI: km/h; US: mph. */
export const AASHTO_FMAX: Record<Units, readonly (readonly [number, number])[]> = {
  SI: [[20, 0.35], [30, 0.28], [40, 0.23], [50, 0.19], [60, 0.17], [70, 0.15], [80, 0.14], [90, 0.13], [100, 0.12], [110, 0.11], [120, 0.09]],
  US: [[15, 0.32], [20, 0.27], [25, 0.23], [30, 0.2], [35, 0.18], [40, 0.16], [45, 0.15], [50, 0.14], [55, 0.13], [60, 0.12], [65, 0.11], [70, 0.1], [75, 0.09], [80, 0.08]],
};
/**
 * Average running speeds used by AASHTO superelevation distribution Method 5. With these, Method 5 reproduces the
 * NYSDOT Exhibits M2-12..14 (SI, emax 4/6/8%) and TxDOT Tables 4-6/4-7 (US, emax 6/8%) to within ±0.1% of e
 * (±0.25% at 20–30 km/h, where the tabulated radii are small whole metres).
 */
export const AASHTO_RUNNING_SPEED: Record<Units, readonly (readonly [number, number])[]> = {
  SI: [[20, 20], [30, 30], [40, 40], [50, 47], [60, 55], [70, 63], [80, 70], [90, 77], [100, 85], [110, 91], [120, 98]],
  US: [[15, 15], [20, 20], [25, 24], [30, 28], [35, 32], [40, 36], [45, 40], [50, 44], [55, 48], [60, 52], [65, 55], [70, 58], [75, 61], [80, 64]],
};
/** Maximum relative gradient Δ (%) for superelevation runoff (two-lane, rotated about the centreline; Indiana Fig. 43-3E; 130 km/h per WYDOT RDM 3-02). */
export const AASHTO_RELATIVE_GRADIENT: Record<Units, readonly (readonly [number, number])[]> = {
  SI: [[20, 0.8], [30, 0.75], [40, 0.7], [50, 0.65], [60, 0.6], [70, 0.55], [80, 0.5], [90, 0.47], [100, 0.44], [110, 0.41], [120, 0.38], [130, 0.35]],
  US: [[15, 0.78], [20, 0.74], [25, 0.7], [30, 0.66], [35, 0.62], [40, 0.58], [45, 0.54], [50, 0.5], [55, 0.47], [60, 0.45], [65, 0.43], [70, 0.4], [75, 0.38], [80, 0.35]],
};
/** Multilane runoff adjustment factor bw by number of lanes rotated (Indiana Fig. 43-3G). */
export const AASHTO_BW: readonly (readonly [number, number])[] = [[1, 1], [1.5, 0.83], [2, 0.75], [2.5, 0.7], [3, 0.67], [3.5, 0.64]];

function aashtoTable(table: readonly (readonly [number, number])[], V: number, u: Units, what: string) {
  const r = interpTable(table, V);
  need(r.inRange, `AASHTO ${what} is tabulated for ${table[0][0]}–${table[table.length - 1][0]} ${speedUnit(u)}; ${V} ${speedUnit(u)} is outside`);
  return r;
}
export const aashtoFmax = (V: number, u: Units = "SI") => aashtoTable(AASHTO_FMAX[u], V, u, "fmax").value;

/** AASHTO rounding of computed Rmin: nearest 1 (nearest 10 at 1000 and above). Reproduces NYSDOT M2-12..14 and TxDOT 4-6/4-7. */
export const roundAashtoRadius = (R: number) => (R >= 1000 ? Math.round(R / 10) * 10 : Math.round(R));

/** Minimum radius R = V²/(C(e + f)); e and f as decimals, C = 127 (SI) or 15 (US). */
export const minRadius = (V: number, e: number, f: number, u: Units = "SI") => (V * V) / (radiusConstant(u) * (e + f));
/** Speed at which R, e and f are in balance: V = √(C·R·(e + f)). */
export const safeSpeed = (R: number, e: number, f: number, u: Units = "SI") => Math.sqrt(radiusConstant(u) * R * (e + f));
/** Superelevation needed so that side friction does not exceed f: e = V²/(C·R) − f. */
export const superelevationForFriction = (V: number, R: number, f: number, u: Units = "SI") => (V * V) / (radiusConstant(u) * R) - f;

/** AASHTO Method 5 distribution of e and f (Green Book Eqs. 3-12 to 3-17). e, emax as decimals. */
export function aashtoMethod5(V: number, R: number, emax: number, u: Units = "SI") {
  const C = radiusConstant(u);
  const fT = aashtoTable(AASHTO_FMAX[u], V, u, "fmax");
  const vT = aashtoTable(AASHTO_RUNNING_SPEED[u], V, u, "running speed");
  const fmax = fT.value, VR = vT.value;
  const iRmin = (C * (emax + fmax)) / (V * V);
  const Rmin = 1 / iRmin;
  const iRpi = (C * emax) / (VR * VR);
  const h = (emax * V * V) / (VR * VR) - emax;
  const s1 = h / iRpi;
  const s2 = (fmax - h) / (iRmin - iRpi);
  const Mo = (iRpi * (iRmin - iRpi) * (s2 - s1)) / (2 * iRmin);
  const iR = 1 / R;
  const exceeds = iR > iRmin * (1 + 1e-9);
  const x = Math.min(iR, iRmin);
  const f = x <= iRpi ? Mo * (x / iRpi) ** 2 + s1 * x : Mo * ((iRmin - x) / (iRmin - iRpi)) ** 2 + h + s2 * (x - iRpi);
  const e = (V * V * x) / C - f;
  return { e, f, fmax, runningSpeed: VR, Rmin, exceedsEmax: exceeds, interpolated: !fT.exact };
}

/** Largest AASHTO design speed for which R ≥ Rmin at superelevation e (fmax varies with speed). */
export function aashtoMaxSpeedForRadius(R: number, e: number, u: Units = "SI") {
  const t = AASHTO_FMAX[u];
  const C = radiusConstant(u);
  const g = (V: number) => (V * V) / (C * R) - e - interpTable(t, V).value;
  const lo = t[0][0], hi = t[t.length - 1][0];
  if (g(lo) > 0) return { V: undefined as number | undefined, belowRange: true, aboveRange: false };
  if (g(hi) <= 0) return { V: hi, belowRange: false, aboveRange: true };
  let a = lo, b = hi;
  for (let i = 0; i < 100; i++) { const m = (a + b) / 2; if (g(m) > 0) b = m; else a = m; }
  return { V: a, belowRange: false, aboveRange: false };
}

/**
 * AASHTO superelevation runoff Lr = w·n1·e·bw/Δ (Indiana Eq. 43-3.1/43-3.3; e and Δ in %) and tangent runout
 * TR = Lr·eNC/e (Eq. 43-3.2). Default lane 3.6 m (12 ft), one lane rotated each side of the centreline.
 */
export function aashtoRunoff(V: number, ePct: number, u: Units = "SI", opts: { laneWidth?: number; lanesRotated?: number; normalCrossSlope?: number } = {}) {
  const w = opts.laneWidth ?? (u === "US" ? 12 : 3.6);
  const n1 = opts.lanesRotated ?? 1;
  const eNC = opts.normalCrossSlope ?? 2;
  need(n1 >= 1 && n1 <= 3.5, "Lanes rotated must be 1 to 3.5");
  const d = aashtoTable(AASHTO_RELATIVE_GRADIENT[u], V, u, "relative gradient").value;
  const bw = interpTable(AASHTO_BW, n1).value;
  const Lr = (w * n1 * ePct * bw) / d;
  const TR = ePct > 0 ? (Lr * eNC) / ePct : 0;
  return { relativeGradient: d, bw, laneWidth: w, lanesRotated: n1, runoff: Lr, tangentRunout: TR, onTangent: (2 / 3) * Lr, onTangentRange: [0.6 * Lr, 0.8 * Lr] as [number, number] };
}

/** IRC:73 superelevation: e = V²/(225R) (75% of speed, no friction) ≤ emax; if capped, check f = V²/(127R) − emax ≤ fmax, else limit the speed. */
export function ircSuperelevation(V: number, R: number, emax = 0.07, fmax = 0.15) {
  const e1 = (V * V) / (225 * R);
  if (e1 <= emax) return { e1, e: e1, fRequired: undefined as number | undefined, ok: true, allowableSpeed: undefined as number | undefined };
  const fRequired = (V * V) / (127 * R) - emax;
  const ok = fRequired <= fmax;
  return { e1, e: emax, fRequired, ok, allowableSpeed: ok ? undefined : safeSpeed(R, emax, fmax) };
}

// RHD tables (km/h, m)
export const RHD_SPEEDS = [30, 40, 50, 65, 80, 100] as const;
export type RhdRoad = "single_lane" | "two_lane" | "dual";
export type SightType = "SSD" | "ISD" | "OSD";
/** RHD Table 5.1 minimum curve radii (m). */
export const RHD_MIN_RADIUS: Record<string, Partial<Record<number, number>>> = {
  "single_lane:ISD": { 30: 120, 40: 250, 50: 500, 65: 1000 },
  "two_lane:SSD": { 30: 35, 40: 65, 50: 120, 65: 250, 80: 500, 100: 1000 },
  "two_lane:ISD": { 30: 120, 40: 250, 50: 500, 65: 1000, 80: 2000, 100: 4000 },
  "two_lane:OSD": { 30: 500, 40: 1000, 50: 2000, 65: 4000, 80: 8000 },
  "dual:ISD": { 50: 500, 65: 1000, 80: 2000, 100: 4000 },
};
/** RHD Table 5.2 minimum superelevation (%): columns are radii; null = not applicable ("-"), 0 = nil. */
export const RHD_E_RADII = [20, 35, 65, 120, 250, 500, 1000, 2000, 4000] as const;
export const RHD_E_TABLE: Record<number, (number | null)[]> = {
  30: [7, 5, 3, 0, 0, null, null, null, null],
  40: [null, 7, 5, 3, 0, 0, null, null, null],
  50: [null, null, 7, 5, 3, 0, 0, null, null],
  65: [null, null, null, 7, 5, 3, 0, 0, null],
  80: [null, null, null, null, 7, 5, 3, 0, 0],
  100: [null, null, null, null, null, 7, 3, 3, 0],
};
/** RHD Table 5.3: plan transition Lp for e = 7/5/3 % and straight transition Lc (m); dual-carriageway values in brackets in the table. */
export const RHD_TRANSITION: Record<number, [number, number, number, number]> = { 30: [25, 15, 10, 10], 40: [35, 20, 13, 13], 50: [45, 25, 15, 15], 65: [55, 35, 20, 20], 80: [65, 45, 25, 25], 100: [75, 55, 35, 35] };
export const RHD_TRANSITION_DUAL: Record<number, [number, number, number, number]> = { 50: [55, 35, 20, 20], 65: [65, 45, 25, 25], 80: [75, 55, 35, 35], 100: [95, 65, 45, 45] };

/** RHD tables are given at 30/40/50/65/80/100 km/h: use the next higher tabulated speed (conservative). */
export function rhdSpeed(V: number): { speed: number; note?: string } {
  positive(V, "Design speed");
  need(V <= 100, "RHD's highest permissible design speed is 100 km/h (80 km/h for normal design, Sec. 2.5)");
  const s = RHD_SPEEDS.find((x) => x >= V - 1e-9)!;
  return { speed: s, note: s !== V ? `RHD tabulates 30/40/50/65/80/100 km/h: ${V} km/h uses the ${s} km/h row (next higher, conservative).` : undefined };
}

export function rhdMinRadius(V: number, road: RhdRoad = "two_lane", sight: SightType = "SSD") {
  const { speed, note } = rhdSpeed(V);
  const key = `${road}:${sight}`;
  const tab = RHD_MIN_RADIUS[key];
  need(!!tab, `RHD Table 5.1 has no ${sight} column for ${road.replace("_", "-")} roads (single-lane and dual roads are designed to ISD)`);
  const R = tab[speed];
  need(R !== undefined, `RHD Table 5.1 gives no ${sight} radius for ${road.replace("_", "-")} roads at ${speed} km/h`);
  return { speed, R: R!, note };
}

/** RHD Table 5.2 lookup; between tabulated radii the next smaller tabulated radius is used (conservative). */
export function rhdSuperelevation(V: number, R: number) {
  const { speed, note } = rhdSpeed(V);
  positive(R, "Radius");
  const row = RHD_E_TABLE[speed];
  const defined = RHD_E_RADII.map((r, i) => [r, row[i]] as const).filter(([, v]) => v !== null) as [number, number][];
  if (R < defined[0][0]) return { speed, note, status: "below" as const, e: 0.07, column: defined[0][0], minTabulated: defined[0][0] };
  let col = defined[0];
  for (const d of defined) if (d[0] <= R) col = d;
  return { speed, note, status: col[1] === 0 ? ("nil" as const) : ("e" as const), e: col[1] / 100, column: col[0], minTabulated: defined[0][0] };
}

/** RHD Table 5.3 transition lengths for e = 3/5/7 %, and the desirable value one speed and one e step higher (Sec. 5.4). */
export function rhdTransition(V: number, ePct: number, dual = false) {
  const { speed } = rhdSpeed(V);
  const idx = (e: number) => (e >= 7 ? 0 : e >= 5 ? 1 : 2);
  const eStep = ePct > 5 ? 7 : ePct > 3 ? 5 : 3;
  const tab = dual ? RHD_TRANSITION_DUAL : RHD_TRANSITION;
  const row = tab[speed];
  need(!!row, `RHD Table 5.3 has no ${dual ? "dual-carriageway " : ""}values at ${speed} km/h`);
  const nextSpeed = RHD_SPEEDS.find((s) => s > speed && tab[s]);
  const nextE = eStep === 3 ? 5 : 7;
  const nrow = nextSpeed ? tab[nextSpeed] : undefined;
  return { speed, eStep, Lp: row[idx(eStep)], Lc: row[3], desirable: nrow ? { speed: nextSpeed!, e: nextE, Lp: nrow[idx(nextE)], Lc: nrow[3] } : undefined };
}

/** LGED (2005) p.11: E = V²/(127R) in flat land, V²/(225R) in hill tracts, limit 1 in 15. */
export const LGED_E_MAX = 1 / 15;
/** LGED Table-6: radius beyond which no superelevation is needed (flat terrain). */
export const LGED_NO_SUPERELEVATION = { upazila: { radius: 610, speed: 50 }, union: { radius: 460, speed: 40 } } as const;
/** LGED transition length: the longer of V³/(28R) and QV²/(28R), Q = 73 flat / 29 hills; minimum 15 m (≤ 40 km/h), 20 m (40–50 km/h). */
export function lgedTransition(V: number, R: number, terrain: "plain" | "hilly" = "plain") {
  const Q = terrain === "hilly" ? 29 : 73;
  const L1 = V ** 3 / (28 * R), L2 = (Q * V * V) / (28 * R);
  const min = V <= 40 ? 15 : V <= 50 ? 20 : undefined;
  return { L1, L2, Q, min, L: Math.max(L1, L2, min ?? 0) };
}

export interface RadiusSuperelevationInput {
  units?: Units;
  standard: RoadStandard;
  designSpeed?: number;
  radius?: number;
  emax?: number; // % (AASHTO default 8; IRC 7; RHD 7; LGED 6.67)
  sideFriction?: number; // f override
  superelevation?: number; // % provided, for the safe-speed mode
  terrain?: "plain" | "rolling" | "hilly";
  roadType?: RhdRoad;
  sightDistanceType?: SightType;
  roadClass?: "upazila" | "union" | "village";
  laneWidth?: number;
  lanesRotated?: number;
  normalCrossSlope?: number; // %
}

/**
 * Minimum radius for a speed (speed only), superelevation for a radius and speed (both), or the safe speed on a radius
 * (radius only), by standard.
 */
export function radiusSuperelevation(inp: RadiusSuperelevationInput) {
  const u = inp.units ?? "SI";
  const std = inp.standard;
  const V = inp.designSpeed, R = inp.radius;
  const su = speedUnit(u), lu = lengthUnit(u);
  const C = radiusConstant(u);
  const steps: string[] = [], checks: Check[] = [], notes: string[] = [];
  need(V !== undefined || R !== undefined, "Give the design speed, the radius, or both");
  if (V !== undefined) positive(V, "Design speed");
  if (R !== undefined) positive(R, "Radius");
  if (std !== "AASHTO") need(u === "SI", `${std} is a metric standard: use units SI (km/h, m)`);
  const mode = V !== undefined && R === undefined ? "min_radius" : V !== undefined && R !== undefined ? "superelevation" : "safe_speed";
  const out: Record<string, unknown> = { standard: std, units: u, mode };

  if (std === "AASHTO") {
    const emax = (inp.emax ?? 8) / 100;
    need(emax > 0 && emax <= 0.12, "emax must be between 0 and 12 %");
    out.emax = emax;
    if (V !== undefined) {
      const fT = aashtoTable(AASHTO_FMAX[u], V, u, "fmax");
      const f = inp.sideFriction ?? fT.value;
      const Rmin = minRadius(V, emax, f, u);
      steps.push(`fmax = ${f2(f)} at ${V} ${su}${inp.sideFriction !== undefined ? " (given)" : fT.exact ? " (Green Book Table 3-7)" : " (interpolated in Table 3-7)"}`);
      steps.push(u === "US" ? `Rmin = V²/(15(0.01e + f)) = ${V}²/(15×(0.01×${f2(emax * 100)} + ${f2(f)})) = ${f1(Rmin)} ft` : `Rmin = V²/(127(e + f)) = ${V}²/(127×(${f3(emax)} + ${f2(f)})) = ${f1(Rmin)} m`);
      steps.push(`AASHTO tables round to the nearest ${Rmin >= 1000 ? "10" : "1"} ${lu}: ${roundAashtoRadius(Rmin)} ${lu}`);
      Object.assign(out, { fmax: f, minRadius: Rmin, minRadiusRounded: roundAashtoRadius(Rmin) });
      if (R !== undefined) {
        const m5 = aashtoMethod5(V, R, emax, u);
        const e = m5.e;
        steps.push(`Method 5 distribution (running speed ${f1(m5.runningSpeed)} ${su}): e = ${pct(e)}, f = ${f3(m5.f)} at R = ${R} ${lu}`);
        let eDesign: number, crown: string;
        if (m5.exceedsEmax) { eDesign = emax; crown = "exceeds emax"; }
        else if (e < 0.015) { eDesign = 0; crown = "NC"; }
        else if (e < 0.02) { eDesign = 0.02; crown = "RC"; }
        else { eDesign = Math.min(emax, ceilTo(e - 0.0002, 0.001)); crown = "superelevated"; }
        steps.push(crown === "NC" ? "e < 1.5%: normal crown may be kept (NYSDOT M2-12..14 notes, Indiana Fig. 43-3B)" : crown === "RC" ? "1.5% ≤ e < 2.0%: remove the adverse crown, superelevate the whole traveled way at 2%" : crown === "superelevated" ? `Design e = ${pct(eDesign, 1)} (rounded up to 0.1%)` : `R < Rmin = ${f1(m5.Rmin)} ${lu}: even emax = ${pct(emax, 0)} is not enough`);
        checks.push({ name: "Radius ≥ Rmin", ok: !m5.exceedsEmax, detail: `R = ${R} ${lu} vs Rmin = ${f1(m5.Rmin)} ${lu} at emax ${pct(emax, 0)}` });
        Object.assign(out, { superelevation: e, superelevationDesign: eDesign, crown, sideFrictionUsed: m5.f });
        if (eDesign > 0) {
          const ro = aashtoRunoff(V, eDesign * 100, u, { laneWidth: inp.laneWidth, lanesRotated: inp.lanesRotated, normalCrossSlope: inp.normalCrossSlope });
          steps.push(`Runoff Lr = w·n1·e·bw/Δ = ${ro.laneWidth}×${ro.lanesRotated}×${f1(eDesign * 100)}×${ro.bw}/${ro.relativeGradient} = ${f1(ro.runoff)} ${lu} (Indiana Eq. 43-3.1/43-3.3)`);
          steps.push(`Tangent runout TR = Lr·eNC/e = ${f1(ro.runoff)}×${inp.normalCrossSlope ?? 2}/${f1(eDesign * 100)} = ${f1(ro.tangentRunout)} ${lu}; place about 2/3 of Lr (${f1(ro.onTangent)} ${lu}, range 60–80%) on the tangent before the PC`);
          out.runoff = ro;
        }
      }
    } else {
      const e = inp.superelevation !== undefined ? inp.superelevation / 100 : emax;
      if (inp.sideFriction !== undefined) {
        const Vs = safeSpeed(R!, e, inp.sideFriction, u);
        steps.push(`V = √(${C}·R·(e + f)) = √(${C}×${R}×(${f3(e)} + ${f2(inp.sideFriction)})) = ${f1(Vs)} ${su}`);
        out.safeSpeed = Vs;
      } else {
        const r = aashtoMaxSpeedForRadius(R!, e, u);
        if (r.belowRange) steps.push(`Even at ${AASHTO_FMAX[u][0][0]} ${su} the radius ${R} ${lu} is below Rmin with e = ${pct(e)}`);
        else {
          const tabV = AASHTO_FMAX[u].filter(([s]) => s <= r.V! + 1e-9).pop()![0];
          steps.push(`Largest design speed with R ≥ V²/(${C}(e + fmax(V))), e = ${pct(e)}: V = ${f1(r.V!)} ${su}${r.aboveRange ? " (top of the table)" : ""}; highest tabulated design speed ${tabV} ${su}`);
          out.designSpeedTabulated = tabV;
        }
        out.safeSpeed = r.V;
        checks.push({ name: "Within AASHTO speed range", ok: !r.belowRange, detail: r.belowRange ? "radius too small for any tabulated design speed" : `V = ${f1(r.V!)} ${su}` });
      }
    }
    notes.push(`Source: ${SOURCES.AASHTO}. emax ${pct(emax, 0)} (AASHTO allows 4–12%; 8% common in rural areas).`);
  } else if (std === "IRC") {
    const emax = (inp.emax ?? 7) / 100, fmax = inp.sideFriction ?? 0.15;
    out.emax = emax; out.fmax = fmax;
    if (V !== undefined && R === undefined) {
      const Rr = minRadius(V, emax, fmax);
      steps.push(`Ruling minimum radius R = V²/(127(e + f)) = ${V}²/(127×(${f2(emax)} + ${f2(fmax)})) = ${f1(Rr)} m`);
      out.minRadius = Rr;
    } else if (V !== undefined && R !== undefined) {
      const r = ircSuperelevation(V, R, emax, fmax);
      steps.push(`e = V²/(225R) = ${V}²/(225×${R}) = ${f3(r.e1)} (75% of the speed, no friction)`);
      if (r.e1 <= emax) steps.push(`${f3(r.e1)} ≤ ${f2(emax)}: provide e = ${f3(r.e1)} (not less than the camber)`);
      else {
        steps.push(`${f3(r.e1)} > ${f2(emax)}: limit e to ${f2(emax)}; f = V²/(127R) − e = ${V}²/(127×${R}) − ${f2(emax)} = ${f3(r.fRequired!)}`);
        steps.push(r.ok ? `f = ${f3(r.fRequired!)} ≤ ${f2(fmax)}: OK with e = ${f2(emax)}` : `f = ${f3(r.fRequired!)} > ${f2(fmax)}: limit the speed to V = √(127R(e + f)) = √(127×${R}×${f2(emax + fmax)}) = ${f2(r.allowableSpeed!)} km/h, or increase R to ${f1(minRadius(V, emax, fmax))} m`);
      }
      checks.push({ name: "Side friction ≤ fmax", ok: r.ok, detail: r.fRequired === undefined ? "no friction needed at 75% speed" : `f = ${f3(r.fRequired)} vs ${f2(fmax)}` });
      const eF = superelevationForFriction(V, R, fmax);
      steps.push(`For reference, e for full friction f = ${f2(fmax)}: e = V²/(127R) − f = ${f3(eF)}`);
      Object.assign(out, { superelevation: r.e, e1: r.e1, fRequired: r.fRequired, allowableSpeed: r.allowableSpeed, superelevationFullFriction: eF, minRadius: minRadius(V, emax, fmax) });
    } else {
      const e = inp.superelevation !== undefined ? inp.superelevation / 100 : emax;
      const Vs = safeSpeed(R!, e, fmax);
      steps.push(`V = √(127R(e + f)) = √(127×${R}×(${f3(e)} + ${f2(fmax)})) = ${f2(Vs)} km/h`);
      out.safeSpeed = Vs;
    }
    notes.push(`Source: ${SOURCES.IRC}. IRC:73 limits e to 0.07 in plain and rolling terrain; f = 0.15.`);
  } else if (std === "RHD") {
    const road = inp.roadType ?? "two_lane";
    const sight = inp.sightDistanceType ?? (road === "two_lane" ? "SSD" : "ISD");
    if (V !== undefined) {
      const mr = rhdMinRadius(V, road, sight);
      if (mr.note) notes.push(mr.note);
      steps.push(`RHD Table 5.1 (${road.replace("_", "-")}, ${sight}) at ${mr.speed} km/h: Rmin = ${mr.R} m`);
      if (road === "two_lane") {
        const alt = (["SSD", "ISD", "OSD"] as SightType[]).map((s) => `${s} ${RHD_MIN_RADIUS[`two_lane:${s}`][mr.speed] ?? "-"}`).join(", ");
        steps.push(`Two-lane radii at ${mr.speed} km/h: ${alt} m. Do not use radii between the SSD and ISD values (Sec. 5.2 step 3): curves must be clearly non-overtaking or clearly overtaking`);
      }
      out.minRadius = mr.R;
      if (R !== undefined) {
        checks.push({ name: `Radius ≥ RHD ${sight} minimum`, ok: R >= mr.R, detail: `R = ${R} m vs ${mr.R} m` });
        if (road === "two_lane") {
          const ssd = RHD_MIN_RADIUS["two_lane:SSD"][mr.speed]!, isd = RHD_MIN_RADIUS["two_lane:ISD"][mr.speed];
          if (isd !== undefined && R > ssd && R < isd) checks.push({ name: "Radius not between SSD and ISD standards", ok: false, detail: `${R} m lies between ${ssd} m (SSD) and ${isd} m (ISD), RHD Sec. 5.2` });
        }
        const se = rhdSuperelevation(V, R);
        if (se.status === "below") {
          steps.push(`RHD Table 5.2 at ${se.speed} km/h starts at R = ${se.minTabulated} m (7%): R = ${R} m is sharper than any tabulated curve`);
          checks.push({ name: "Radius within RHD Table 5.2", ok: false, detail: `R = ${R} m < ${se.minTabulated} m` });
        } else if (se.status === "nil") steps.push(`RHD Table 5.2 at ${se.speed} km/h, R ≥ ${se.column} m: nil, no superelevation (keep 3% crossfall)`);
        else steps.push(`RHD Table 5.2 at ${se.speed} km/h, R ≥ ${se.column} m: minimum e = ${pct(se.e, 0)}${se.e === 0.03 ? " (removal of adverse crossfall only)" : ""}${R !== se.column ? `; ${R} m lies between tabulated radii, the next smaller (${se.column} m) is used` : ""}`);
        out.superelevation = se.status === "nil" ? 0 : se.e;
        out.superelevationStatus = se.status;
        if (se.status === "e") {
          const tr = rhdTransition(V, se.e * 100, road === "dual");
          steps.push(`RHD Table 5.3 at ${tr.speed} km/h, e ${tr.eStep}%: plan transition Lp = ${tr.Lp} m, straight transition Lc = ${tr.Lc} m${tr.desirable ? `; desirable for future upgrade (one speed and one e higher: ${tr.desirable.speed} km/h, ${tr.desirable.e}%): Lp = ${tr.desirable.Lp} m, Lc = ${tr.desirable.Lc} m` : ""}`);
          const shift = tr.Lp ** 2 / (24 * R);
          steps.push(`Shift = L²/(24R) = ${tr.Lp}²/(24×${R}) = ${f3(shift)} m${shift < 0.25 ? " < 0.25 m: the transition curve may be omitted (Sec. 5.4); develop e over Lc + Lp with 2/3 before the curve" : ""}`);
          out.transition = { ...tr, shift };
        }
        notes.push("RHD: maximum superelevation 7%; the axis of rotation is the inner carriageway edge (freeboard above HFL); without transitions, develop e uniformly over Lc + Lp with two-thirds before the curve (Sec. 5.3).");
      }
    } else {
      const key = `${road}:${sight}`;
      const tab = RHD_MIN_RADIUS[key];
      need(!!tab, `RHD Table 5.1 has no ${sight} column for ${road.replace("_", "-")} roads`);
      const ok = RHD_SPEEDS.filter((s) => tab[s] !== undefined && tab[s]! <= R!);
      const Vt = ok.length ? ok[ok.length - 1] : undefined;
      steps.push(Vt ? `RHD Table 5.1 (${road.replace("_", "-")}, ${sight}): R = ${R} m ≥ ${tab[Vt]} m → highest tabulated design speed ${Vt} km/h` : `R = ${R} m is below the smallest RHD Table 5.1 ${sight} radius (${Object.values(tab)[0]} m)`);
      const e = inp.superelevation !== undefined ? inp.superelevation / 100 : 0.07;
      const Vi = safeSpeed(R!, e, 0.15);
      steps.push(`RHD publishes no side-friction factor. IRC check: V = √(127R(e + f)) = √(127×${R}×(${f2(e)} + 0.15)) = ${f1(Vi)} km/h`);
      Object.assign(out, { safeSpeed: Vt, safeSpeedIrcFormula: Vi });
      checks.push({ name: "Radius meets an RHD design speed", ok: Vt !== undefined, detail: Vt ? `${Vt} km/h` : "below 30 km/h standards" });
    }
    notes.push(`Source: ${SOURCES.RHD}, Tables 5.1–5.3. RHD publishes no side-friction factor; where a formula is needed the IRC value f = 0.15 is used and labelled.`);
  } else {
    // LGED
    const terrain = inp.terrain === "hilly" ? "hilly" : "plain";
    const emax = inp.emax !== undefined ? inp.emax / 100 : LGED_E_MAX;
    const fIRC = inp.sideFriction ?? 0.15;
    if (V !== undefined && R === undefined) {
      const Rm = minRadius(V, emax, fIRC);
      steps.push(`LGED publishes no minimum radius or friction factor. With LGED emax 1/15 and IRC f = ${f2(fIRC)}: R = V²/(127(e + f)) = ${V}²/(127×(${f3(emax)} + ${f2(fIRC)})) = ${f1(Rm)} m`);
      out.minRadius = Rm;
    } else if (V !== undefined && R !== undefined) {
      const cls = inp.roadClass;
      const t6 = cls === "upazila" || cls === "union" ? LGED_NO_SUPERELEVATION[cls] : undefined;
      if (t6 && terrain === "plain" && V <= t6.speed && R >= t6.radius) {
        steps.push(`LGED Table-6: ${cls} road (flat), R = ${R} m ≥ ${t6.radius} m at ≤ ${t6.speed} km/h: no superelevation needed (keep the camber)`);
        out.superelevation = 0;
      } else {
        const Cf = terrain === "hilly" ? 225 : 127;
        const E = (V * V) / (Cf * R);
        steps.push(`LGED p.11 (${terrain === "hilly" ? "hill tracts" : "flat land"}): E = V²/(${Cf}R) = ${V}²/(${Cf}×${R}) = ${f3(E)} (1 in ${f1(1 / E)})`);
        let e = E;
        if (E > emax) {
          e = emax;
          const f = (V * V) / (127 * R) - emax;
          steps.push(`E > 1/15 (LGED limit for Bangladesh loaded-cart traffic): use e = ${f3(emax)}. LGED gives no friction factor; IRC check f = V²/(127R) − e = ${f3(f)} ${f <= fIRC ? "≤" : ">"} ${f2(fIRC)}`);
          checks.push({ name: "Side friction ≤ 0.15 (IRC, LGED silent)", ok: f <= fIRC, detail: f <= fIRC ? `f = ${f3(f)}` : `f = ${f3(f)}: limit the speed to ${f1(safeSpeed(R, emax, fIRC))} km/h or flatten the curve` });
          out.fRequired = f;
        }
        const camber = 1 / 60;
        if (e < camber) { steps.push(`e below the bituminous camber 1 in 60: provide ${f3(camber)} (superelevation never less than camber)`); e = camber; }
        out.superelevation = e;
        if (t6 && terrain === "plain" && V > t6.speed) notes.push(`LGED Table-6 radius (${t6.radius} m) is for ${t6.speed} km/h; not applied at ${V} km/h.`);
      }
      const tl = lgedTransition(V, R, terrain);
      steps.push(`Transition: L = V³/(28R) = ${f1(tl.L1)} m; L = QV²/(28R) = ${tl.Q}×${V}²/(28×${R}) = ${f1(tl.L2)} m; take the longer${tl.min ? `, minimum ${tl.min} m` : ""} → ${f1(tl.L)} m`);
      if (!tl.min) notes.push("LGED gives minimum transition lengths only up to 50 km/h.");
      notes.push("LGED transition formula is printed as L = QV²/(28R) with Q = 73/29 (V in km/h, R in m): Q/28 ≈ 2.6/1.0, the same form as IRC's 2.7V²/R (plain) and V²/R (hills). Implemented as printed.");
      out.transition = tl;
    } else {
      const e = inp.superelevation !== undefined ? inp.superelevation / 100 : emax;
      const Vs = safeSpeed(R!, e, fIRC);
      const V0 = Math.sqrt(127 * R! * e);
      steps.push(`Speed fully balanced by e = ${f3(e)} alone (LGED flat-land formula): V = √(127Re) = ${f1(V0)} km/h; with IRC f = ${f2(fIRC)}: V = √(127R(e + f)) = ${f1(Vs)} km/h`);
      Object.assign(out, { safeSpeed: Vs, balancedSpeed: V0 });
    }
    notes.push(`Source: ${SOURCES.LGED}, p.11 and Table-6. V is the design speed, generally 2/3 to 3/4 of the road speed (LGED p.11). Superelevation never less than the camber (bituminous 1 in 60; HBB 1 in 36 to 1 in 48).`);
  }
  const eReq = typeof out.superelevationDesign === "number" ? out.superelevationDesign : typeof out.superelevation === "number" ? out.superelevation : undefined;
  if (mode === "superelevation" && inp.superelevation !== undefined && eReq !== undefined) {
    checks.push({ name: "Provided superelevation ≥ required", ok: inp.superelevation / 100 >= eReq - 1e-9, detail: `${inp.superelevation}% provided vs ${pct(eReq, 1)} required` });
  }
  return { ...out, steps, checks, notes };
}

// ---------------- Sight distance ----------------

/** IRC:66 / IRC:SP:23 longitudinal friction coefficient for SSD by design speed (km/h). */
export const IRC_SSD_FRICTION: readonly (readonly [number, number])[] = [[20, 0.4], [25, 0.4], [30, 0.4], [40, 0.38], [50, 0.37], [60, 0.36], [65, 0.36], [80, 0.35], [100, 0.35]];
/** RHD Table 2.3 sight distances (m): [SSD, ISD, OSD] for two-lane roads; single-lane roads use the ISD column. */
export const RHD_SIGHT: Record<number, [number, number, number]> = { 30: [30, 60, 120], 40: [45, 90, 180], 50: [60, 120, 250], 65: [90, 180, 360], 80: [120, 250, 500], 100: [180, 360, 720] };

/**
 * AASHTO stopping sight distance. Level: 0.278Vt + 0.039V²/a (SI) or 1.47Vt + 1.075V²/a (US). On a grade G (%, + up):
 * 0.278Vt + V²/(254((a/9.81) + G)) or 1.47Vt + V²/(30((a/32.2) + G)). t = 2.5 s, a = 3.4 m/s² (11.2 ft/s²).
 * The design value is rounded up to 5 m (5 ft).
 */
export function aashtoSSD(V: number, u: Units = "SI", opts: { t?: number; a?: number; grade?: number } = {}) {
  positive(V, "Design speed");
  const t = opts.t ?? 2.5, a = opts.a ?? (u === "US" ? 11.2 : 3.4), G = (opts.grade ?? 0) / 100;
  const reaction = (u === "US" ? 1.47 : 0.278) * V * t;
  let braking: number, formula: string;
  if (G === 0) {
    braking = u === "US" ? (1.075 * V * V) / a : (0.039 * V * V) / a;
    formula = u === "US" ? `SSD = 1.47Vt + 1.075V²/a = 1.47×${V}×${t} + 1.075×${V}²/${a}` : `SSD = 0.278Vt + 0.039V²/a = 0.278×${V}×${t} + 0.039×${V}²/${a}`;
  } else {
    const gg = u === "US" ? 32.2 : G_SI, k = u === "US" ? 30 : 254;
    need(a / gg + G > 0, "Grade too steep for the deceleration rate");
    braking = (V * V) / (k * (a / gg + G));
    formula = `SSD = ${u === "US" ? "1.47" : "0.278"}Vt + V²/(${k}((a/${gg}) ${G >= 0 ? "+" : "−"} G)) = ${u === "US" ? "1.47" : "0.278"}×${V}×${t} + ${V}²/(${k}×(${f3(a / gg)} ${G >= 0 ? "+" : "−"} ${f3(Math.abs(G))}))`;
  }
  const ssd = reaction + braking;
  return { reaction, braking, ssd, design: ceilTo(ssd, 5), formula: `${formula} = ${f2(reaction)} + ${f2(braking)} = ${f1(ssd)} ${lengthUnit(u)}` };
}

/** IRC SSD = vt + v²/(2g(f + n)), v in m/s, n = grade as a decimal (+ up, − down). f defaults to IRC:SP:23 by speed. */
export function ircSSD(V: number, opts: { t?: number; f?: number; grade?: number } = {}) {
  positive(V, "Design speed");
  const t = opts.t ?? 2.5;
  const fT = interpTable(IRC_SSD_FRICTION, V);
  const f = opts.f ?? fT.value;
  const n = (opts.grade ?? 0) / 100;
  need(f + n > 0, "Downgrade steeper than the friction coefficient: vehicle cannot stop");
  const v = V / 3.6;
  const lag = v * t, braking = (v * v) / (2 * G_SI * (f + n));
  const ssd = lag + braking;
  return { v, f, fFromTable: opts.f === undefined, fInRange: fT.inRange, lag, braking, ssd, formula: `SSD = vt + v²/(2g(f ${n >= 0 ? "+" : "−"} n)) = ${f2(v)}×${t} + ${f2(v)}²/(2×9.81×(${f2(f)} ${n >= 0 ? "+" : "−"} ${f3(Math.abs(n))})) = ${f2(lag)} + ${f2(braking)} = ${f1(ssd)} m` };
}

/**
 * Overtaking sight distance on a two-way road (IRC:66 form): d1 = vb·t (t = 2 s), s = 0.7vb + 6, T = √(4s/a),
 * d2 = vb·T + 2s, d3 = v·T; OSD = d1 + d2 + d3. v and vb in m/s, a in m/s².
 */
export function ircOSD(V: number, acceleration: number, overtakenSpeed?: number, t = 2) {
  positive(V, "Design speed"); positive(acceleration, "Acceleration");
  const Vb = overtakenSpeed ?? V - 16;
  need(Vb > 0 && Vb < V, "Overtaken vehicle speed must be positive and below the design speed");
  const v = V / 3.6, vb = Vb / 3.6;
  const s = 0.7 * vb + 6, T = Math.sqrt((4 * s) / acceleration);
  const d1 = vb * t, d2 = vb * T + 2 * s, d3 = v * T;
  return { Vb, s, T, d1, d2, d3, osd: d1 + d2 + d3 };
}

export interface SightDistanceInput {
  units?: Units;
  standard: RoadStandard;
  designSpeed: number;
  grade?: number; // %, + up, − down
  reactionTime?: number; // s
  deceleration?: number; // AASHTO a, m/s² or ft/s²
  friction?: number; // IRC longitudinal f
  roadType?: RhdRoad;
  overtakenSpeed?: number; // km/h, IRC OSD
  acceleration?: number; // m/s², IRC OSD
}

export function sightDistance(inp: SightDistanceInput) {
  const u = inp.units ?? "SI";
  const std = inp.standard;
  const V = inp.designSpeed;
  positive(V, "Design speed");
  if (std !== "AASHTO") need(u === "SI", `${std} is a metric standard: use units SI (km/h, m)`);
  const grade = inp.grade ?? 0;
  need(Math.abs(grade) <= 15, "Grade must be within ±15%");
  const steps: string[] = [], checks: Check[] = [], notes: string[] = [];
  const out: Record<string, unknown> = { standard: std, units: u, designSpeed: V, grade };
  const lu = lengthUnit(u);

  if (std === "AASHTO") {
    const tab = AASHTO_FMAX[u];
    need(V >= tab[0][0] - 1e-9 && V <= (u === "US" ? 80 : 130), `AASHTO SSD here covers ${tab[0][0]}–${u === "US" ? 80 : 130} ${speedUnit(u)}`);
    const lvl = aashtoSSD(V, u, { t: inp.reactionTime, a: inp.deceleration });
    steps.push(`Level: ${lvl.formula}; design value (rounded up to 5 ${lu}) = ${lvl.design} ${lu}`);
    out.ssdLevel = lvl.ssd; out.ssdLevelDesign = lvl.design;
    let gov = lvl;
    if (grade !== 0) {
      const g = aashtoSSD(V, u, { t: inp.reactionTime, a: inp.deceleration, grade });
      steps.push(`On ${grade > 0 ? "+" : ""}${grade}% grade: ${g.formula}; design ${g.design} ${lu}`);
      out.ssdGrade = g.ssd; out.ssdGradeDesign = g.design;
      gov = g;
    }
    Object.assign(out, { ssd: gov.ssd, ssdDesign: gov.design });
    notes.push(`Source: ${SOURCES.AASHTO}. t = ${inp.reactionTime ?? 2.5} s, a = ${inp.deceleration ?? (u === "US" ? 11.2 : 3.4)} ${u === "US" ? "ft/s²" : "m/s²"}. AASHTO passing sight distance is not included in this tool.`);
  } else if (std === "RHD" || std === "LGED" || std === "IRC") {
    const irc = ircSSD(V, { t: inp.reactionTime, f: inp.friction, grade });
    const ircLevel = ircSSD(V, { t: inp.reactionTime, f: inp.friction });
    if (std === "RHD") {
      const { speed, note } = rhdSpeed(V);
      if (note) notes.push(note);
      const [ssd, isd, osd] = RHD_SIGHT[speed];
      const single = inp.roadType === "single_lane";
      steps.push(`RHD Table 2.3 at ${speed} km/h: SSD ${ssd} m, ISD ${isd} m, OSD ${osd} m (eye 1.2 m; object 0.15 m for SSD, 1.2 m for ISD/OSD)`);
      if (single) steps.push("Single-lane roads are designed to ISD (opposing vehicles share the lane), RHD Sec. 2.6");
      else if (inp.roadType === "dual") steps.push("Dual carriageways should be designed to provide ISD, RHD Sec. 2.6");
      else steps.push("Two-lane roads: SSD everywhere, a high proportion with ISD or better OSD, RHD Sec. 2.6");
      Object.assign(out, { ssd, isd, osd, tabulatedSpeed: speed, design: single || inp.roadType === "dual" ? isd : ssd });
      steps.push(`RHD publishes no SSD formula or grade correction. IRC formula for reference: level ${f1(ircLevel.ssd)} m${grade !== 0 ? `; on ${grade}% grade ${irc.formula}` : ""}`);
      out.ssdIrcFormula = irc.ssd;
      if (grade < 0) checks.push({ name: "Downgrade SSD (IRC formula) within RHD value", ok: irc.ssd <= ssd, detail: `IRC formula on ${grade}% gives ${f1(irc.ssd)} m vs RHD ${ssd} m${irc.ssd > ssd ? ": consider the larger value" : ""}` });
      notes.push(`Source: ${SOURCES.RHD}, Table 2.3 and Sec. 2.6. IRC formula (${SOURCES.IRC}) shown for grade effect, labelled.`);
    } else {
      steps.push(`${std === "LGED" ? "LGED (2005) gives no sight-distance values; IRC formula used. " : ""}f = ${f2(irc.f)}${irc.fFromTable ? " (IRC:SP:23 by speed)" : " (given)"}`);
      if (!irc.fInRange && irc.fFromTable) notes.push("Speed outside the IRC friction table (20–100 km/h): end value used.");
      steps.push(grade !== 0 ? `Level: ${ircLevel.formula}` : ircLevel.formula);
      if (grade !== 0) steps.push(`On ${grade > 0 ? "+" : ""}${grade}% grade: ${irc.formula}`);
      steps.push(`ISD = 2 × SSD = ${f1(2 * irc.ssd)} m; on a single-lane two-way road the SSD is doubled: ${f1(2 * irc.ssd)} m`);
      Object.assign(out, { ssd: irc.ssd, ssdLevel: ircLevel.ssd, isd: 2 * irc.ssd, singleLaneTwoWay: 2 * irc.ssd, friction: irc.f });
      if (inp.acceleration !== undefined) {
        const o = ircOSD(V, inp.acceleration, inp.overtakenSpeed);
        steps.push(`OSD: vb = ${f1(o.Vb)} km/h, s = 0.7vb + 6 = ${f2(o.s)} m, T = √(4s/a) = ${f2(o.T)} s; d1 = vb·t = ${f1(o.d1)}, d2 = vb·T + 2s = ${f1(o.d2)}, d3 = v·T = ${f1(o.d3)} → OSD = ${f1(o.osd)} m (two-way road)`);
        out.osd = o.osd;
      } else notes.push("OSD needs the acceleration of the overtaking vehicle (m/s²): give 'acceleration' to compute it.");
      notes.push(`Source: ${SOURCES.IRC}.`);
    }
  }
  return { ...out, steps, checks, notes };
}

// ---------------- Vertical curves ----------------

/** AASHTO minimum K (rounded design values): SI per NYSDOT/Indiana (20–120 km/h); US (15–80 mph) each = SSD²/2158 or SSD²/(400 + 3.5·SSD) rounded. */
export const AASHTO_K: Record<Units, { crest: readonly (readonly [number, number])[]; sag: readonly (readonly [number, number])[] }> = {
  SI: {
    crest: [[20, 1], [30, 2], [40, 4], [50, 7], [60, 11], [70, 17], [80, 26], [90, 39], [100, 52], [110, 74], [120, 95]],
    sag: [[20, 3], [30, 6], [40, 9], [50, 13], [60, 18], [70, 23], [80, 30], [90, 38], [100, 45], [110, 55], [120, 63]],
  },
  US: {
    crest: [[15, 3], [20, 7], [25, 12], [30, 19], [35, 29], [40, 44], [45, 61], [50, 84], [55, 114], [60, 151], [65, 193], [70, 247], [75, 312], [80, 384]],
    sag: [[15, 10], [20, 17], [25, 26], [30, 37], [35, 49], [40, 64], [45, 79], [50, 96], [55, 115], [60, 136], [65, 157], [70, 181], [75, 206], [80, 231]],
  },
};
/** RHD Table 6.1 minimum K. */
export const RHD_K: Record<string, Partial<Record<number, number>>> = {
  "single_lane:ISD": { 30: 4, 40: 9, 50: 18, 65: 35 },
  "two_lane:SSD": { 30: 2, 40: 4, 50: 9, 65: 18, 80: 35, 100: 70 },
  "two_lane:ISD": { 30: 4, 40: 9, 50: 18, 65: 35, 80: 70, 100: 140 },
  "two_lane:OSD": { 30: 18, 40: 35, 50: 70, 65: 140, 80: 270, 100: 540 },
  "dual:ISD": { 50: 18, 65: 35, 80: 70, 100: 140 },
};
/** RHD Table 6.2: [max change of grade without a vertical curve %, minimum length for appearance m]. */
export const RHD_APPEARANCE: Record<number, [number, number]> = { 30: [1.5, 15], 40: [1.2, 20], 50: [1.0, 30], 65: [0.8, 40], 80: [0.6, 50], 100: [0.5, 60] };
/** RHD Table 6.3 maximum gradient (%). */
export const RHD_MAX_GRADE = { plain: 3, rolling: 5, hilly: 7 } as const;
/** LGED Table-5 gradients (%): ruling / limiting. */
export const LGED_GRADE = { plain: { ruling: 100 / 30, limiting: 100 / 20 }, hilly: { ruling: 100 / 20, limiting: 100 / 15 } } as const;

/** Crest constant with A in %: 100(√(2h1) + √(2h2))². 1.08/0.60 m → 658; 3.5/2.0 ft → 2158; 1.2/0.15 m → 440; 1.2/1.2 m → 960. */
export const crestConstant = (h1: number, h2: number) => 100 * (Math.sqrt(2 * h1) + Math.sqrt(2 * h2)) ** 2;

/**
 * Length from sight distance, choosing the case correctly: compute with the S < L formula; if that length is shorter
 * than S the assumption is false, so use the S ≥ L formula. Crest: L = AS²/C or 2S − C/A. Sag (headlight):
 * L = AS²/(B + 3.5S) or 2S − (B + 3.5S)/A. A in %.
 */
export function sightLength(kind: "crest" | "sag", A: number, S: number, k: number) {
  positive(A, "A"); positive(S, "Sight distance");
  const D = kind === "crest" ? k : k + 3.5 * S;
  const sLtL = (A * S * S) / D;
  const sGeL = 2 * S - D / A;
  const useFirst = sLtL >= S;
  return { case: useFirst ? ("S<L" as const) : ("S>=L" as const), L: useFirst ? sLtL : Math.max(0, sGeL), formulaSltL: sLtL, formulaSgeL: sGeL, denominator: D };
}
/** IRC sag comfort length L = 2(N·v³/C)^½, N = A/100, v in m/s, C = 0.6 m/s³. */
export const sagComfortIRC = (A: number, V: number, C = 0.6) => 2 * Math.sqrt(((A / 100) * (V / 3.6) ** 3) / C);
/** AASHTO sag comfort length L = AV²/395 (SI) or AV²/46.5 (US). */
export const sagComfortAASHTO = (A: number, V: number, u: Units = "SI") => (A * V * V) / (u === "US" ? 46.5 : 395);

export interface VerticalCurveInput {
  units?: Units;
  standard?: RoadStandard;
  g1: number; // % back tangent
  g2: number; // % forward tangent
  designSpeed?: number;
  sightDistance?: number;
  sightDistanceType?: SightType;
  roadType?: RhdRoad;
  K?: number;
  length?: number;
  pviChainage?: number;
  pviLevel?: number;
  interval?: number;
  terrain?: "plain" | "rolling" | "hilly";
}

export interface LevelRow { point: string; chainage: number; label: string; x: number; tangentLevel: number; correction: number; level: number }

export function verticalCurve(inp: VerticalCurveInput) {
  const u = inp.units ?? "SI";
  const std = inp.standard ?? "AASHTO";
  if (std !== "AASHTO") need(u === "SI", `${std} is a metric standard: use units SI (km/h, m)`);
  const { g1, g2 } = inp;
  need(Number.isFinite(g1) && Number.isFinite(g2), "Give both grades g1 and g2 in %");
  need(Math.abs(g1) <= 30 && Math.abs(g2) <= 30, "Grades are in percent (e.g. 3 for 3%); values above 30% are not accepted");
  const A = Math.abs(g2 - g1);
  need(A > 1e-9, "The grades are equal: no vertical curve is needed");
  const kind: "crest" | "sag" = g2 < g1 ? "crest" : "sag";
  const V = inp.designSpeed;
  if (V !== undefined) positive(V, "Design speed");
  for (const k of ["sightDistance", "K", "length", "interval"] as const) if (inp[k] !== undefined) positive(inp[k], k);
  const lu = lengthUnit(u), su = speedUnit(u);
  const steps: string[] = [], checks: Check[] = [], notes: string[] = [];
  steps.push(`A = |g2 − g1| = |${g2} − (${g1})| = ${f3(A)}% → ${kind} curve`);
  const road = inp.roadType ?? "two_lane";
  const sightType = inp.sightDistanceType ?? (std === "RHD" && road !== "two_lane" ? "ISD" : "SSD");
  const needed: { name: string; L: number }[] = [];
  const out: Record<string, unknown> = { standard: std, units: u, A, type: kind };

  // Sight distance S and the length constant
  let S = inp.sightDistance, Ssrc = "given";
  let k: number | undefined, kDesc = "";
  if (kind === "crest") {
    if (std === "AASHTO") {
      if (sightType === "SSD") { k = u === "US" ? 2158 : 658; kDesc = u === "US" ? "h1 3.5 ft, h2 2.0 ft" : "h1 1.08 m, h2 0.60 m"; }
      else { k = u === "US" ? 2800 : 864; kDesc = u === "US" ? "passing, h1 = h2 = 3.5 ft" : "passing, h1 = h2 = 1.08 m"; }
    } else if (sightType === "SSD") { k = std === "RHD" ? crestConstant(1.2, 0.15) : 440; kDesc = std === "RHD" ? "h1 1.2 m, h2 0.15 m (RHD Sec. 2.6; constant computed, RHD prints only 960)" : "h1 1.2 m, h2 0.15 m (IRC L = NS²/4.4)"; }
    else { k = 960; kDesc = "h1 = h2 = 1.2 m (960 as printed by RHD Sec. 6.3; IRC NS²/9.6)"; }
  } else {
    k = std === "AASHTO" ? (u === "US" ? 400 : 120) : 150;
    kDesc = std === "AASHTO" ? (u === "US" ? "headlight 2.0 ft, 1° beam" : "headlight 0.6 m, 1° beam") : "headlight 0.75 m, 1° beam (IRC L = NS²/(1.5 + 0.035S))";
  }
  const sagSight: SightType = kind === "sag" ? "SSD" : sightType;
  if (S === undefined && V !== undefined) {
    if (std === "AASHTO") {
      need(sagSight === "SSD", "AASHTO passing sight distance is not included: give sightDistance for a passing-sight crest");
      S = aashtoSSD(V, u).design; Ssrc = `AASHTO design SSD at ${V} ${su}`;
    } else if (std === "RHD") {
      const { speed, note } = rhdSpeed(V);
      if (note) notes.push(note);
      S = RHD_SIGHT[speed][sagSight === "SSD" ? 0 : sagSight === "ISD" ? 1 : 2]; Ssrc = `RHD Table 2.3 ${sagSight} at ${speed} km/h`;
    } else {
      need(sagSight !== "OSD", "Give sightDistance for an OSD crest under IRC/LGED");
      const s = ircSSD(V).ssd;
      S = sagSight === "ISD" ? 2 * s : s; Ssrc = `IRC ${sagSight}${sagSight === "ISD" ? " = 2 × SSD" : ""} at ${V} km/h (level, f = ${f2(interpTable(IRC_SSD_FRICTION, V).value)})`;
    }
  }
  if (S !== undefined) {
    const r = sightLength(kind, A, S, k!);
    const expr = kind === "crest" ? `AS²/${f1(k!)}` : `AS²/(${k} + 3.5S)`;
    const expr2 = kind === "crest" ? `2S − ${f1(k!)}/A` : `2S − (${k} + 3.5S)/A`;
    steps.push(`Sight distance S = ${f1(S)} ${lu} (${Ssrc}); ${kind === "crest" ? `${sagSight}, ${kDesc}` : kDesc}`);
    steps.push(`Assume S < L: L = ${expr} = ${f3(A)}×${f1(S)}²/${f1(r.denominator)} = ${f2(r.formulaSltL)} ${lu}`);
    if (r.case === "S<L") steps.push(`${f2(r.formulaSltL)} ≥ S = ${f1(S)}: assumption holds, L = ${f2(r.L)} ${lu}${std === "RHD" ? ` (RHD Sec. 6.3 check L = ${expr2} = ${f2(r.formulaSgeL)} ${lu}, not governing)` : ""}`);
    else steps.push(`${f2(r.formulaSltL)} < S = ${f1(S)}: the curve is shorter than S, so use S ≥ L: L = ${expr2} = 2×${f1(S)} − ${f1(r.denominator)}/${f3(A)} = ${f2(r.formulaSgeL)} ${lu}${r.formulaSgeL <= 0 ? " ≤ 0: sight distance is available without a curve" : ""}`);
    out.sightDistance = S;
    out.sight = r;
    needed.push({ name: `${kind === "crest" ? sagSight : "headlight"} sight distance (${r.case === "S<L" ? "S < L" : "S ≥ L"})`, L: r.L });
  }

  // Minimum K by standard
  let Kmin: number | undefined, Ksrc = "";
  if (V !== undefined && std === "AASHTO" && sightType === "SSD") {
    const t = AASHTO_K[u][kind];
    need(V >= t[0][0] - 1e-9 && V <= t[t.length - 1][0] + 1e-9, `AASHTO K is tabulated for ${t[0][0]}–${t[t.length - 1][0]} ${su}`);
    const row = t.find(([s]) => s >= V - 1e-9)!;
    Kmin = row[1]; Ksrc = `AASHTO ${kind} K at ${row[0]} ${su}${row[0] !== V ? " (next higher tabulated speed)" : ""}`;
  } else if (V !== undefined && std === "RHD") {
    const { speed } = rhdSpeed(V);
    const tab = RHD_K[`${road}:${sightType}`];
    need(!!tab, `RHD Table 6.1 has no ${sightType} column for ${road.replace("_", "-")} roads`);
    Kmin = tab[speed]; Ksrc = `RHD Table 6.1 (${road.replace("_", "-")}, ${sightType}) at ${speed} km/h`;
    need(Kmin !== undefined, `RHD Table 6.1 gives no ${sightType} K for ${road.replace("_", "-")} roads at ${speed} km/h`);
    if (kind === "sag") notes.push("RHD Sec. 6.1: sag curves may be designed in the same way as crest curves, so the Table 6.1 K is applied; the headlight length uses the IRC formula (RHD gives none), labelled.");
  }
  if (Kmin !== undefined) {
    steps.push(`Minimum K = ${Kmin} (${Ksrc}): L = K·A = ${Kmin}×${f3(A)} = ${f2(Kmin * A)} ${lu}`);
    needed.push({ name: `minimum K = ${Kmin}`, L: Kmin * A });
    out.Kmin = Kmin;
  }
  // Minimum / appearance length
  if (V !== undefined && std === "AASHTO") {
    const Lm = (u === "US" ? 3 : 0.6) * V;
    steps.push(`Minimum length ${u === "US" ? "3V" : "0.6V"} = ${f1(Lm)} ${lu} (AASHTO)`);
    needed.push({ name: `minimum length ${u === "US" ? "3V" : "0.6V"}`, L: Lm });
  } else if (V !== undefined && std === "RHD") {
    const { speed } = rhdSpeed(V);
    const [maxA, Lm] = RHD_APPEARANCE[speed];
    steps.push(`RHD Table 6.2 at ${speed} km/h: a vertical curve is needed when A > ${maxA}%; minimum length for appearance ${Lm} m`);
    checks.push({ name: "Vertical curve needed (RHD Table 6.2)", ok: true, detail: A > maxA ? `A = ${f2(A)}% > ${maxA}%: provide a curve` : `A = ${f2(A)}% ≤ ${maxA}%: a curve is not required` });
    needed.push({ name: "RHD appearance length", L: Lm });
  }
  // Sag comfort
  if (kind === "sag" && V !== undefined) {
    if (std === "AASHTO") {
      const Lc = sagComfortAASHTO(A, V, u);
      steps.push(`Comfort (AASHTO): L = AV²/${u === "US" ? "46.5" : "395"} = ${f3(A)}×${V}²/${u === "US" ? "46.5" : "395"} = ${f2(Lc)} ${lu}`);
      needed.push({ name: "comfort AV²/" + (u === "US" ? "46.5" : "395"), L: Lc });
    } else {
      const Lc = sagComfortIRC(A, V);
      steps.push(`Comfort (IRC): L = 2(N·v³/C)^½ = 2×(${f3(A / 100)}×${f2(V / 3.6)}³/0.6)^½ = ${f2(Lc)} m`);
      needed.push({ name: "comfort (IRC, C = 0.6 m/s³)", L: Lc });
    }
  }
  const userKL = inp.K !== undefined ? inp.K * A : undefined;
  if (userKL !== undefined) steps.push(`Given K = ${inp.K}: L = K·A = ${f2(userKL)} ${lu}`);
  need(needed.length > 0 || inp.length !== undefined || userKL !== undefined, "Give the design speed, a sight distance, K or a length");
  const gov = needed.reduce((a, b) => (b.L > a.L ? b : a), { name: "none", L: 0 });
  if (needed.length) steps.push(`Required length = max(${needed.map((n) => `${n.name} ${f2(n.L)}`).join("; ")}) = ${f2(gov.L)} ${lu}`);
  const L = inp.length ?? userKL ?? gov.L;
  need(L > 0, "No curve length results: give a length or K");
  if (inp.length !== undefined || userKL !== undefined) checks.push({ name: "Length ≥ required", ok: L >= gov.L - 1e-6, detail: `L = ${f2(L)} vs required ${f2(gov.L)} ${lu} (${gov.name})` });
  if (Kmin !== undefined) checks.push({ name: `K ≥ ${Ksrc.split(" at ")[0]} minimum`, ok: L / A >= Kmin - 1e-6, detail: `K = L/A = ${f2(L / A)} vs ${Kmin}` });
  // Gradient limits
  const gMax = Math.max(Math.abs(g1), Math.abs(g2));
  if (std === "RHD" && inp.terrain) checks.push({ name: `Maximum gradient (RHD Table 6.3, ${inp.terrain})`, ok: gMax <= RHD_MAX_GRADE[inp.terrain], detail: `${f2(gMax)}% vs ${RHD_MAX_GRADE[inp.terrain]}%` });
  if (std === "LGED") {
    const t = LGED_GRADE[inp.terrain === "hilly" ? "hilly" : "plain"];
    checks.push({ name: `Gradient (LGED Table-5, ${inp.terrain === "hilly" ? "hills" : "plain"})`, ok: gMax <= t.limiting + 1e-9, detail: `${f2(gMax)}% vs ruling ${f2(t.ruling)}%, limiting ${f2(t.limiting)}%${gMax > t.ruling && gMax <= t.limiting ? ": above ruling, keep such lengths short" : ""}` });
  }
  Object.assign(out, { requiredLength: gov.L, governing: gov.name, length: L, K: L / A, criteria: needed });

  // Geometry
  if (inp.pviChainage !== undefined) {
    const pvi = inp.pviChainage;
    const pvc = pvi - L / 2, pvt = pvi + L / 2;
    steps.push(`PVC = PVI − L/2 = ${f2(pvi)} − ${f2(L / 2)} = ${f2(pvc)} (${formatChainage(pvc, u)}); PVT = PVI + L/2 = ${f2(pvt)} (${formatChainage(pvt, u)})`);
    Object.assign(out, { pvc, pvt, pvcLabel: formatChainage(pvc, u), pvtLabel: formatChainage(pvt, u) });
    if (inp.pviLevel !== undefined) {
      const z0 = inp.pviLevel - (g1 * L) / 200;
      const zT = inp.pviLevel + (g2 * L) / 200;
      const y = (x: number) => z0 + (g1 * x) / 100 + ((g2 - g1) * x * x) / (200 * L);
      steps.push(`Level PVC = ${f3(inp.pviLevel)} − ${g1}%×${f2(L / 2)} = ${f3(z0)}; PVT = ${f3(inp.pviLevel)} + ${g2}%×${f2(L / 2)} = ${f3(zT)}; y(x) = z_PVC + g1·x/100 + (g2 − g1)x²/(200L)`);
      Object.assign(out, { pvcLevel: z0, pvtLevel: zT, pviLevel: inp.pviLevel, midCurveLevel: y(L / 2) });
      let turning: { chainage: number; level: number; x: number } | undefined;
      if (g1 * g2 < 0) {
        const x = (g1 * L) / (g1 - g2);
        turning = { x, chainage: pvc + x, level: y(x) };
        steps.push(`${kind === "crest" ? "High" : "Low"} point: x = g1·L/(g1 − g2) = ${g1}×${f2(L)}/(${g1} − (${g2})) = ${f2(x)} ${lu} from PVC → ${formatChainage(pvc + x, u)}, level ${f3(y(x))}`);
        out.turningPoint = turning;
      } else steps.push(`Both grades have the same sign: no ${kind === "crest" ? "high" : "low"} point inside the curve (it is at the ${Math.abs(g1) < Math.abs(g2) ? "PVC" : "PVT"})`);
      const step = inp.interval ?? (u === "US" ? 50 : 20);
      need(L / step <= 2000, "Station interval too small for this curve length");
      const xs: { x: number; point: string }[] = [{ x: 0, point: "PVC" }];
      for (let c = Math.ceil(pvc / step - 1e-9) * step; c < pvt - 1e-6; c += step) if (c > pvc + 1e-6) xs.push({ x: c - pvc, point: "" });
      xs.push({ x: L / 2, point: "PVI" });
      if (turning) xs.push({ x: turning.x, point: kind === "crest" ? "High point" : "Low point" });
      xs.push({ x: L, point: "PVT" });
      xs.sort((a, b) => a.x - b.x);
      const rows: LevelRow[] = [];
      for (const p of xs) {
        const dup = rows.find((r) => Math.abs(r.x - p.x) < 1e-6);
        if (dup) { if (p.point) dup.point = dup.point ? `${dup.point} / ${p.point}` : p.point; continue; }
        const corr = ((g2 - g1) * p.x * p.x) / (200 * L);
        rows.push({ point: p.point, chainage: pvc + p.x, label: formatChainage(pvc + p.x, u), x: p.x, tangentLevel: z0 + (g1 * p.x) / 100, correction: corr, level: y(p.x) });
      }
      out.levels = rows;
      steps.push(...rows.slice(0, 80).map((r) => `${r.point ? r.point + " " : ""}${r.label}: x ${f2(r.x)}, tangent ${f3(r.tangentLevel)}, offset ${r.correction >= 0 ? "+" : ""}${f3(r.correction)} → level ${f3(r.level)}`));
      if (rows.length > 80) steps.push(`… ${rows.length - 80} more stations in result.levels`);
    }
  }
  notes.push(`Source: ${SOURCES[std]}.${std === "LGED" ? " LGED (2005) gives gradients only; curve lengths use the IRC formulas, labelled." : ""} Crest: S < L → L = AS²/C, S ≥ L → L = 2S − C/A; the S < L result is used only when it is at least S.`);
  return { ...out, steps, checks, notes };
}

// ---------------- Cross-sections (RHD, LGED) ----------------

export interface SectionType {
  type: number; carriageway: number; carriageways: number; lanes: number; shoulder: number; shoulderMedianSide?: number; median?: number; divider?: number; nmvLane?: number;
  verge: number; crest: number; traffic: string; classification: string;
}
/** RHD Table 2.1 and Figs. 4.2–4.7 (m). Shoulders are paved. */
export const RHD_TYPES: Record<number, SectionType> = {
  1: { type: 1, carriageway: 11.0, carriageways: 2, lanes: 6, shoulder: 1.8, shoulderMedianSide: 0.3, median: 1.0, divider: 0.6, nmvLane: 3.0, verge: 0.9, crest: 36.2, traffic: "4500–8500 PCU/peak hour (MV AADT 19,000–36,000)", classification: "National" },
  2: { type: 2, carriageway: 7.3, carriageways: 2, lanes: 4, shoulder: 1.8, shoulderMedianSide: 0.3, median: 1.0, verge: 0.9, crest: 21.6, traffic: "2100–4500 PCU/peak hour (MV AADT 7,000–19,000)", classification: "National" },
  3: { type: 3, carriageway: 7.3, carriageways: 1, lanes: 2, shoulder: 1.5, verge: 3.0, crest: 16.3, traffic: "1600–2100 PCU/peak hour (MV AADT 5,000–7,000)", classification: "Regional" },
  4: { type: 4, carriageway: 6.2, carriageways: 1, lanes: 2, shoulder: 1.5, verge: 1.45, crest: 12.1, traffic: "800–1600 PCU/peak hour (MV AADT 1,000–5,000)", classification: "Regional" },
  5: { type: 5, carriageway: 5.5, carriageways: 1, lanes: 2, shoulder: 1.2, verge: 0.95, crest: 9.8, traffic: "400–800 PCU/peak hour (MV AADT 500–1,000)", classification: "Feeder" },
  6: { type: 6, carriageway: 3.7, carriageways: 1, lanes: 1, shoulder: 1.2, verge: 1.85, crest: 9.8, traffic: "< 400 PCU/peak hour (MV AADT < 500)", classification: "Feeder" },
};
const RHD_PCU_LIMIT: [number, number][] = [[400, 6], [800, 5], [1600, 4], [2100, 3], [4500, 2], [8500, 1]];
/** RHD Table 2.2 typical design speeds (km/h) by terrain. */
export const RHD_DESIGN_SPEED: Record<number, { plain: string; rolling: string; hilly: string }> = {
  1: { plain: "80–100", rolling: "80", hilly: "-" }, 2: { plain: "80–100", rolling: "80", hilly: "-" },
  3: { plain: "80", rolling: "65", hilly: "50" }, 4: { plain: "65", rolling: "50", hilly: "40" },
  5: { plain: "50", rolling: "40", hilly: "30" }, 6: { plain: "50", rolling: "40", hilly: "30" },
};
/** LGED Table-4 (m); hard shoulder 0.9 m on Type 5 only. */
export const LGED_TYPES: Record<number, SectionType> = {
  8: { type: 8, carriageway: 3.0, carriageways: 1, lanes: 1, shoulder: 0, verge: 1.25, crest: 5.5, traffic: "≤ 50 commercial vehicles/day (≈ 90 PCU/peak hour)", classification: "Union road / village road" },
  7: { type: 7, carriageway: 3.7, carriageways: 1, lanes: 1, shoulder: 0, verge: 0.9, crest: 5.5, traffic: "≤ 100 commercial vehicles/day (≈ 130 PCU/peak hour)", classification: "Union road" },
  6: { type: 6, carriageway: 3.7, carriageways: 1, lanes: 1, shoulder: 0, verge: 1.8, crest: 7.3, traffic: "≤ 200 commercial vehicles/day (≈ 210 PCU/peak hour)", classification: "Upazila road" },
  5: { type: 5, carriageway: 3.7, carriageways: 1, lanes: 1, shoulder: 0.9, verge: 0.9, crest: 7.3, traffic: "≤ 300 commercial vehicles/day (≈ 290 PCU/peak hour)", classification: "Upazila road" },
  4: { type: 4, carriageway: 5.5, carriageways: 1, lanes: 2, shoulder: 0, verge: 2.15, crest: 9.8, traffic: "≤ 600 commercial vehicles/day or 530 PCU/peak hour", classification: "Upazila road (special type)" },
};
const LGED_CV_LIMIT: [number, number][] = [[50, 8], [100, 7], [200, 6], [300, 5], [600, 4]];
const LGED_PCU_LIMIT: [number, number][] = [[90, 8], [130, 7], [210, 6], [290, 5], [530, 4]];

/** RHD Table 5.4 extra carriageway width (m): [lower bound of radius band, 3.7 m single lane, 6.2 m, 7.3 m]. */
export const RHD_WIDENING: [number, number, number, number][] = [[0, 1.8, 2.4, 2.1], [16, 1.5, 2.1, 1.8], [21, 1.2, 1.8, 1.5], [36, 0.9, 1.5, 1.2], [66, 0.6, 1.2, 0.9], [121, 0, 0.9, 0.6], [201, 0, 0.6, 0], [351, 0, 0.6, 0], [601, 0, 0, 0]];
const RHD_WIDENING_LABEL = ["≤ 15", "16–20", "21–35", "36–65", "66–120", "121–200", "201–350", "351–600", "601–1000 and above"];

/** RHD Table 5.4 lookup; a radius between the integer bands uses the band below (more widening). */
export function rhdWidening(R: number, carriageway: number) {
  positive(R, "Radius");
  const col = carriageway <= 3.7 + 1e-9 ? 1 : carriageway <= 6.2 + 1e-9 ? 2 : 3;
  let i = 0;
  for (let j = 0; j < RHD_WIDENING.length; j++) if (R >= RHD_WIDENING[j][0]) i = j;
  return { widening: RHD_WIDENING[i][col], band: RHD_WIDENING_LABEL[i], column: col === 1 ? "3.7 m single lane" : col === 2 ? "6.2 m two lane" : "7.3 m two lane", belowTable: R < 15 };
}
/** LGED Table-7 extra width (m): ≤ 60 → 1.2; > 60–150 → 0.9; > 150–300 → 0.6; > 300–900 → 0.3; > 900 → nil. */
export function lgedWidening(R: number) {
  positive(R, "Radius");
  const w = R <= 60 ? 1.2 : R <= 150 ? 0.9 : R <= 300 ? 0.6 : R <= 900 ? 0.3 : 0;
  return { widening: w, band: R <= 60 ? "up to 60 m" : R <= 150 ? "above 60 to 150 m" : R <= 300 ? "above 150 to 300 m" : R <= 900 ? "above 300 to 900 m" : "above 900 m" };
}

export interface CrossSectionInput {
  standard: RoadStandard;
  designType?: number;
  pcuPeakHour?: number;
  commercialVehiclesPerDay?: number;
  radius?: number;
  terrain?: "plain" | "rolling" | "hilly";
}

export function roadCrossSection(inp: CrossSectionInput) {
  const std = inp.standard;
  need(std === "RHD" || std === "LGED", "Cross-section types are available for RHD (national/regional/feeder) and LGED (upazila/union) roads");
  const steps: string[] = [], checks: Check[] = [], notes: string[] = [];
  const types = std === "RHD" ? RHD_TYPES : LGED_TYPES;
  let t = inp.designType;
  if (t === undefined) {
    if (std === "RHD") {
      need(inp.pcuPeakHour !== undefined, "Give the RHD design type (1–6) or the design-year peak-hour PCU");
      const hit = RHD_PCU_LIMIT.find(([lim]) => inp.pcuPeakHour! <= lim);
      need(!!hit, `${inp.pcuPeakHour} PCU/peak hour exceeds the Type 1 design capacity (8500)`);
      t = hit![1];
      steps.push(`RHD Table 2.1: ${inp.pcuPeakHour} PCU/peak hour (design year, usually the 10th year) → Type ${t}`);
    } else {
      need(inp.commercialVehiclesPerDay !== undefined || inp.pcuPeakHour !== undefined, "Give the LGED design type (4–8), commercial vehicles per day or peak-hour PCU");
      const [val, lims, what] = inp.commercialVehiclesPerDay !== undefined ? [inp.commercialVehiclesPerDay, LGED_CV_LIMIT, "commercial vehicles/day"] as const : [inp.pcuPeakHour!, LGED_PCU_LIMIT, "PCU/peak hour"] as const;
      const hit = lims.find(([lim]) => val <= lim);
      need(!!hit, `${val} ${what} exceeds LGED Type 4 (600 CV/day, 530 PCU): use an RHD design type`);
      t = hit![1];
      steps.push(`LGED Table-3: ${val} ${what} (10-year projection) → Type ${t}`);
    }
  }
  const s = types[t];
  need(!!s, `${std} design types are ${Object.keys(types).join(", ")}`);
  const rows: [string, number][] = [];
  const side = s.verge + s.shoulder + (s.nmvLane ?? 0) + (s.divider ?? 0) + (s.shoulderMedianSide ?? 0);
  rows.push([`Carriageway${s.carriageways > 1 ? ` (×${s.carriageways})` : ""}, ${s.lanes} lane${s.lanes > 1 ? "s" : ""}`, s.carriageway]);
  if (s.shoulder) rows.push([std === "RHD" ? "Paved shoulder (each side)" : "Hard shoulder (each side)", s.shoulder]);
  if (s.shoulderMedianSide) rows.push(["Paved shoulder next to median (each carriageway)", s.shoulderMedianSide]);
  if (s.median) rows.push(["Median", s.median]);
  if (s.divider) rows.push(["Divider (NMV lane)", s.divider]);
  if (s.nmvLane) rows.push(["NMV lane (each side)", s.nmvLane]);
  rows.push(["Verge (each side)", s.verge]);
  const sum = s.carriageway * s.carriageways + 2 * side + (s.median ?? 0);
  rows.push(["Crest width", s.crest]);
  steps.push(`${std} Type ${t} (${s.classification}; ${s.traffic}): ${rows.map(([n, w]) => `${n} ${w} m`).join(", ")}`);
  steps.push(`Crest = ${s.carriageways > 1 ? `2×${s.carriageway}` : s.carriageway} + 2×(${[s.verge, s.shoulder, s.nmvLane, s.divider, s.shoulderMedianSide].filter((x) => x).join(" + ")})${s.median ? ` + ${s.median}` : ""} = ${f2(sum)} m`);
  checks.push({ name: "Elements add up to the crest width", ok: Math.abs(sum - s.crest) < 0.01, detail: `${f2(sum)} vs ${s.crest} m` });
  const out: Record<string, unknown> = { standard: std, designType: t, section: s, elements: rows };
  if (std === "RHD") {
    const sp = RHD_DESIGN_SPEED[t];
    steps.push(`Typical design speed (RHD Table 2.2): plain ${sp.plain}, rolling ${sp.rolling}, hilly ${sp.hilly} km/h; maximum 100 km/h, normally 80 km/h`);
    steps.push("Crossfall (RHD Sec. 4.7): carriageway 3%, shoulders normally 5%");
    steps.push(`Maximum gradient (RHD Table 6.3): plain 3%, rolling 5%, hilly 7%${inp.terrain ? ` → ${inp.terrain} ${RHD_MAX_GRADE[inp.terrain]}%` : ""}`);
    notes.push("RHD Sec. 4.6: headroom 5.7 m over the full formation; lateral clearance from the shoulder edge 1 m (0.6 m absolute minimum; 1.5 m / 1 m without shoulder); keep a 4 m clear zone beyond the shoulder, doubled on the outside of curves with R < 600 m.");
    if (t === 3) notes.push("Type 3: the verge may be 0.9 m (crest 12.1 m) if NMV lanes will never be needed (Fig. 4.4).");
    if (t <= 4 && t >= 2) notes.push("Consider separate NMV lanes (Types 2a/3a/4a) where design-year NMV flow exceeds 400 PCU/h (50 PCU/h for Type 2), Sec. 4.3.");
    out.designSpeed = sp; out.crossfall = { carriageway: 3, shoulder: 5 }; out.maxGradient = RHD_MAX_GRADE;
  } else {
    steps.push("Camber (LGED p.12): bituminous carpeting 1 in 60 (1.67%); HBB (herring-bone bond brick) 1 in 36 to 1 in 48");
    const tt = inp.terrain === "hilly" ? "hilly" : "plain";
    const g = LGED_GRADE[tt];
    steps.push(`Gradients (LGED Table-5, ${tt === "hilly" ? "hills" : "plain"}): ruling 1 in ${tt === "hilly" ? 20 : 30} (${f2(g.ruling)}%), limiting 1 in ${tt === "hilly" ? 15 : 20} (${f2(g.limiting)}%)`);
    if (t === 4) notes.push("LGED Type 4: a 7.3 m crest (0.9 m verges) may be allowed where land or resources are constrained.");
    out.camber = { bituminous: 1 / 60, hbb: [1 / 48, 1 / 36] }; out.gradient = g;
  }
  if (inp.radius !== undefined) {
    const R = inp.radius;
    positive(R, "Radius");
    if (std === "RHD") {
      if (s.carriageways > 1) {
        need(s.carriageway <= 7.3, "RHD Table 5.4 does not cover the 11 m (three-lane) carriageway of Type 1");
        notes.push("RHD Table 5.4 is for single and two-lane carriageways; for Type 2 the 7.3 m column is applied to each carriageway.");
      }
      const w = rhdWidening(R, s.carriageway);
      if (s.carriageway === 5.5) notes.push("RHD Table 5.4 has no 5.5 m column: the 6.2 m two-lane value is shown (a narrower two-lane road needs at least this much). Confirm with RHD.");
      steps.push(`RHD Table 5.4, R = ${R} m (band ${w.band} m), ${w.column}: extra width ${w.widening ? `${w.widening} m` : "nil"}`);
      if (w.belowTable) checks.push({ name: "Radius within RHD Table 5.4", ok: false, detail: `R = ${R} m < 15 m` });
      if (w.widening) steps.push("With transitions: half on each side of the centreline, developed along the transition. Without: on the inside of the curve, developed over 20 m before the curve (Table 5.4 notes)");
      if (R < 600) steps.push("Clear zone on the outside of this curve: 8 m (4 m doubled for R < 600 m, Sec. 4.6)");
      out.widening = w.widening; out.carriagewayOnCurve = s.carriageway + w.widening;
    } else {
      const w = lgedWidening(R);
      const base = t >= 5 ? 5.5 : s.carriageway;
      steps.push(`LGED Table-7, R = ${R} m (${w.band}): extra width ${w.widening ? `${w.widening} m` : "nil"}, on the inner side, built up along the transition`);
      if (t >= 5) steps.push(`LGED p.10: Types 5–8 carriageway widened to 5.5 m at curves (turning points) with superelevation; Table-7 applies to 3.7 m and 5.5 m pavements → about ${f2(base + w.widening)} m on the curve`);
      out.widening = w.widening; out.carriagewayOnCurve = base + w.widening;
    }
  }
  notes.push(`Source: ${SOURCES[std]}, ${std === "RHD" ? "Tables 2.1, 2.2, 5.4, 6.3 and Figs. 4.2–4.7" : "Tables 3, 4, 5, 7 and pp. 10–12"}.`);
  return { ...out, steps, checks, notes };
}
