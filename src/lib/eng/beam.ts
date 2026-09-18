/**
 * Beam analysis (Euler–Bernoulli) for common single-span cases with
 * point loads, uniformly distributed loads (full or partial) and applied moments.
 *
 * Sign convention: loads positive downward; sagging moment positive;
 * shear positive when the resultant of forces to the left of the section acts upward.
 * Units: length m, force kN, distributed load kN/m, moment kN·m, E in MPa, I in mm⁴.
 */

export type SupportType = "simply_supported" | "cantilever" | "fixed_fixed" | "propped_cantilever";

export interface PointLoad {
  type: "point";
  /** magnitude kN, positive downward */
  magnitude: number;
  /** distance from left end, m */
  position: number;
}
export interface UDL {
  type: "udl";
  /** kN/m, positive downward */
  magnitude: number;
  /** start from left, m (default 0) */
  start?: number;
  /** end from left, m (default span) */
  end?: number;
}
export interface MomentLoad {
  type: "moment";
  /** kN·m, positive clockwise */
  magnitude: number;
  position: number;
}
export type BeamLoad = PointLoad | UDL | MomentLoad;

export interface BeamInput {
  span: number;
  support: SupportType;
  loads: BeamLoad[];
  /** Young's modulus, MPa (default 200000 steel / 25000 concrete) */
  E?: number;
  /** Second moment of area, mm⁴ */
  I?: number;
  /** number of stations along the beam (default 201) */
  stations?: number;
}

export interface BeamResult {
  input: BeamInput;
  reactions: { RA: number; RB: number; MA: number; MB: number };
  x: number[];
  shear: number[];
  moment: number[];
  deflection: number[] | null; // mm
  maxShear: { value: number; x: number };
  maxMomentPositive: { value: number; x: number };
  maxMomentNegative: { value: number; x: number };
  maxDeflection: { value: number; x: number } | null; // mm
  notes: string[];
}

function assertBeam(inp: BeamInput) {
  if (!(inp.span > 0)) throw new Error("span must be > 0");
  for (const l of inp.loads) {
    if (l.type === "point" || l.type === "moment") {
      if (l.position < 0 || l.position > inp.span) throw new Error(`load position ${l.position} outside span`);
    } else {
      const s = l.start ?? 0;
      const e = l.end ?? inp.span;
      if (s < 0 || e > inp.span || e <= s) throw new Error(`UDL range [${s}, ${e}] invalid for span ${inp.span}`);
    }
  }
}

/** Discretize every load into equivalent point loads + concentrated moments (for FEM computation). */
function discretize(inp: BeamInput, n = 400): { P: number; a: number }[] {
  const pts: { P: number; a: number }[] = [];
  for (const l of inp.loads) {
    if (l.type === "point") pts.push({ P: l.magnitude, a: l.position });
    else if (l.type === "udl") {
      const s = l.start ?? 0;
      const e = l.end ?? inp.span;
      const seg = (e - s) / n;
      for (let i = 0; i < n; i++) pts.push({ P: l.magnitude * seg, a: s + seg * (i + 0.5) });
    }
  }
  return pts;
}

/**
 * Compute statically-determinate simply-supported reactions for the given loads.
 * Applied moments: clockwise positive moment M at any position -> RA = -M/L, RB = +M/L.
 */
function simplySupportedReactions(inp: BeamInput): { RA: number; RB: number } {
  const L = inp.span;
  let sumP = 0;
  let momentAboutA = 0; // clockwise positive
  for (const l of inp.loads) {
    if (l.type === "point") {
      sumP += l.magnitude;
      momentAboutA += l.magnitude * l.position;
    } else if (l.type === "udl") {
      const s = l.start ?? 0;
      const e = l.end ?? L;
      const W = l.magnitude * (e - s);
      sumP += W;
      momentAboutA += W * (s + e) / 2;
    } else {
      momentAboutA += l.magnitude;
    }
  }
  const RB = momentAboutA / L;
  const RA = sumP - RB;
  return { RA, RB };
}

/** Shear and moment at x for a beam with known left reaction RA and left end moment MA (sagging +). */
function sectionForces(inp: BeamInput, RA: number, MA: number, x: number): { V: number; M: number } {
  let V = RA;
  let M = RA * x + MA;
  for (const l of inp.loads) {
    if (l.type === "point") {
      if (l.position <= x) {
        V -= l.magnitude;
        M -= l.magnitude * (x - l.position);
      }
    } else if (l.type === "udl") {
      const s = l.start ?? 0;
      const e = Math.min(l.end ?? inp.span, x);
      if (x > s) {
        const len = e - s;
        V -= l.magnitude * len;
        M -= l.magnitude * len * (x - (s + e) / 2);
      }
    } else {
      // clockwise applied moment at position: reduces moment to the right by M (sagging convention)
      if (l.position <= x) M += l.magnitude;
    }
  }
  return { V, M };
}

/** Fixed-end moments (hogging, magnitude) for fixed–fixed beam. */
function fixedEndMoments(inp: BeamInput): { MA: number; MB: number } {
  const L = inp.span;
  let MA = 0;
  let MB = 0;
  for (const { P, a } of discretize(inp)) {
    const b = L - a;
    MA += (P * a * b * b) / (L * L);
    MB += (P * a * a * b) / (L * L);
  }
  for (const l of inp.loads) {
    if (l.type === "moment") {
      // FEM for concentrated clockwise moment M0 at distance a: MA = M0 b (2a - b)/L², MB = M0 a (2b - a)/L² (opposite sense)
      const a = l.position;
      const b = L - a;
      MA += (l.magnitude * b * (2 * a - b)) / (L * L);
      MB -= (l.magnitude * a * (2 * b - a)) / (L * L);
    }
  }
  return { MA, MB };
}

export function analyzeBeam(inp: BeamInput): BeamResult {
  assertBeam(inp);
  const L = inp.span;
  const nSt = Math.max(21, inp.stations ?? 201);
  const notes: string[] = [];

  let RA = 0;
  let RB = 0;
  let MA = 0; // end moment at A applied to beam (sagging positive)
  let MB = 0; // end moment at B (sagging positive)

  if (inp.support === "simply_supported") {
    ({ RA, RB } = simplySupportedReactions(inp));
  } else if (inp.support === "cantilever") {
    // fixed at left (x=0), free at right
    let sumP = 0;
    let momentAboutA = 0;
    for (const l of inp.loads) {
      if (l.type === "point") {
        sumP += l.magnitude;
        momentAboutA += l.magnitude * l.position;
      } else if (l.type === "udl") {
        const s = l.start ?? 0;
        const e = l.end ?? L;
        const W = l.magnitude * (e - s);
        sumP += W;
        momentAboutA += (W * (s + e)) / 2;
      } else momentAboutA += l.magnitude;
    }
    RA = sumP;
    RB = 0;
    MA = -momentAboutA; // hogging at fixed support
    MB = 0;
    notes.push("Cantilever fixed at left end (x = 0), free at right end.");
  } else if (inp.support === "fixed_fixed") {
    const fem = fixedEndMoments(inp);
    MA = -fem.MA;
    MB = -fem.MB;
    const ss = simplySupportedReactions(inp);
    // Moment equilibrium about B: RA·L + MA_applied ... => RA = RA_ss + (MA - MB)/L  (with sagging-positive end moments)
    // From M(L) = RA·L + MA − Σ P·(L − a) = MB  →  RA = RA_ss + (MB − MA)/L
    RA = ss.RA + (MB - MA) / L;
    RB = ss.RB - (MB - MA) / L;
    notes.push("Fixed–fixed beam: end moments from fixed-end-moment superposition.");
  } else if (inp.support === "propped_cantilever") {
    // fixed at left, pinned at right. Use consistent deformation: MA = -(sum of P a b (L + b) / (2 L²)) for point loads.
    let m = 0;
    for (const { P, a } of discretize(inp)) {
      const b = L - a;
      m += (P * a * b * (L + b)) / (2 * L * L);
    }
    for (const l of inp.loads) {
      if (l.type === "moment") {
        // clockwise moment M0 at a from fixed end: MA = M0 (L² - 3 b²) / (2 L²) (approximate standard result)
        const b = L - l.position;
        m -= (l.magnitude * (L * L - 3 * b * b)) / (2 * L * L);
      }
    }
    MA = -m;
    MB = 0;
    const ss = simplySupportedReactions(inp);
    RA = ss.RA - MA / L;
    RB = ss.RB + MA / L;
    notes.push("Propped cantilever: fixed at left (x = 0), simply supported at right.");
  }

  const x: number[] = [];
  const shear: number[] = [];
  const moment: number[] = [];
  // Make sure stations include load positions for sharp SFD
  const stationSet = new Set<number>();
  for (let i = 0; i < nSt; i++) stationSet.add((L * i) / (nSt - 1));
  for (const l of inp.loads) {
    if (l.type === "point" || l.type === "moment") {
      stationSet.add(Math.max(0, l.position - 1e-9));
      stationSet.add(Math.min(L, l.position + 1e-9));
    } else {
      stationSet.add(l.start ?? 0);
      stationSet.add(l.end ?? L);
    }
  }
  const xs = Array.from(stationSet).sort((a, b) => a - b);
  for (const xi of xs) {
    const { V, M } = sectionForces(inp, RA, MA, xi);
    x.push(xi);
    shear.push(V);
    moment.push(M);
  }

  // Deflection by numerical double integration of M/EI
  let deflection: number[] | null = null;
  let maxDeflection: { value: number; x: number } | null = null;
  if (inp.E && inp.I && inp.E > 0 && inp.I > 0) {
    const EI = (inp.E * 1e6) * (inp.I * 1e-12); // N·m²
    const curv = moment.map((m) => (m * 1e3) / EI); // 1/m
    const theta: number[] = [0];
    const y: number[] = [0];
    for (let i = 1; i < x.length; i++) {
      const dx = x[i] - x[i - 1];
      theta.push(theta[i - 1] + ((curv[i] + curv[i - 1]) / 2) * dx);
      y.push(y[i - 1] + ((theta[i] + theta[i - 1]) / 2) * dx);
    }
    // Apply boundary conditions: for simply supported y(L)=0 -> add slope theta0 = -y(L)/L
    let theta0 = 0;
    if (inp.support === "simply_supported") theta0 = -y[y.length - 1] / L;
    // cantilever / fixed_fixed / propped: theta(0)=0 already assumed.
    deflection = y.map((yi, i) => -(yi + theta0 * x[i]) * 1000); // mm, positive downward
    let idx = 0;
    for (let i = 0; i < deflection.length; i++) if (Math.abs(deflection[i]) > Math.abs(deflection[idx])) idx = i;
    maxDeflection = { value: deflection[idx], x: x[idx] };
  } else {
    notes.push("Provide E (MPa) and I (mm⁴) to compute deflections.");
  }

  const pick = (arr: number[], cmp: (a: number, b: number) => boolean) => {
    let idx = 0;
    for (let i = 0; i < arr.length; i++) if (cmp(arr[i], arr[idx])) idx = i;
    return { value: arr[idx], x: x[idx] };
  };
  const maxShear = pick(shear, (a, b) => Math.abs(a) > Math.abs(b));
  const maxMomentPositive = pick(moment, (a, b) => a > b);
  const maxMomentNegative = pick(moment, (a, b) => a < b);

  return {
    input: inp,
    reactions: { RA, RB, MA, MB },
    x,
    shear,
    moment,
    deflection,
    maxShear,
    maxMomentPositive,
    maxMomentNegative,
    maxDeflection,
    notes,
  };
}

/** Rectangular section second moment of area, mm⁴ */
export function rectI(b_mm: number, h_mm: number): number {
  return (b_mm * h_mm ** 3) / 12;
}
