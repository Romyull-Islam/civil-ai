/**
 * Numeric grounding check: every figure in a final answer should come from a tool result, the user's own input,
 * or an earlier (already checked) answer. Models are good at explaining and bad at arithmetic, so a number that
 * appears from nowhere is treated as a likely error.
 */

// Identifiers whose digits are names, not quantities: codes and editions, material grades, bar marks, model names.
// Code prefixes are matched case-sensitively so ordinary words ("is 5.2 m") are not mistaken for "IS 456".
const CODE_ID = /\b(?:IS|BNBC|ACI|ASCE|AISC|BS|EN|GB|GB\/T|JGJ|NBC|BCP|IBC|IRC|SP|ASTM|Eurocode|EC)\s*[-:]?\s*\d[\d.:\-/]*/g;
const WORD_ID = /\b(?:Grade|Gr\.?|clause|cl\.|section|sec\.|table|fig\.?|figure|annex|appendix|chapter|part|step|option|case|type)\s*[\d.]+[a-z]?/gi;
const stripIds = (t: string) => t.replace(CODE_ID, " ").replace(WORD_ID, " ");
// A number, optionally with thousands separators; skipped when glued to a preceding letter (M20, Fe500, Ø16, Q4).
const NUMBER = /(?<![\p{L}\d.])\d{1,3}(?:,\d{3})+(?:\.\d+)?|(?<![\p{L}\d.,])\d+(?:\.\d+)?/gu;

function decimals(token: string): number {
  const i = token.indexOf(".");
  return i < 0 ? 0 : token.length - i - 1;
}

/** All numeric values in a text or JSON string. */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of stripIds(text).matchAll(NUMBER)) out.push(Number(m[0].replace(/,/g, "")));
  return out;
}

/** True when `x` (as written, with its precision) is a rounding of some source value. */
function matches(token: string, x: number, sources: number[]): boolean {
  const d = decimals(token);
  const halfStep = 0.5 * 10 ** -d + 1e-9;
  return sources.some((v) => {
    const a = Math.abs(v);
    return Math.abs(a - x) <= halfStep || (x >= 10 && Math.abs(a - x) <= 0.006 * a) || Math.abs(Math.ceil(a) - x) < 1e-9;
  });
}

/**
 * Figures in `answer` that do not appear (to the precision written) in any of `sources`.
 * Small whole numbers (≤ 10) are ignored: list markers, counts and ratio parts are rarely calculation results.
 */
export function ungroundedNumbers(answer: string, sources: string[]): string[] {
  const pool = sources.flatMap(numbersIn);
  const bad = new Set<string>();
  const cleaned = stripIds(answer).replace(/^\s*\d+[.)]\s/gm, " ");
  for (const m of cleaned.matchAll(NUMBER)) {
    const token = m[0].replace(/,/g, "");
    const x = Number(token);
    if (!Number.isFinite(x) || (x <= 10 && Number.isInteger(x) && !token.includes("."))) continue;
    if (x >= 1900 && x <= 2100 && Number.isInteger(x)) continue; // years / code editions
    if (!matches(token, x, pool)) bad.add(m[0]);
  }
  return [...bad];
}
