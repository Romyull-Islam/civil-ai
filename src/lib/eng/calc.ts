/** Safe arithmetic expression evaluator (no eval). Supports + - * / ^ %, parentheses, unary minus,
 * constants pi/e, functions sqrt, abs, sin, cos, tan, asin, acos, atan, log (ln), log10, exp, pow, min, max, round, floor, ceil.
 * Trig in degrees if suffixed with 'd' (sind, cosd, tand) else radians. */
const FUNCS: Record<string, (...a: number[]) => number> = {
  sqrt: Math.sqrt, abs: Math.abs, sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sind: (x) => Math.sin((x * Math.PI) / 180), cosd: (x) => Math.cos((x * Math.PI) / 180), tand: (x) => Math.tan((x * Math.PI) / 180),
  log: Math.log, ln: Math.log, log10: Math.log10, exp: Math.exp, pow: Math.pow, min: Math.min, max: Math.max, round: Math.round, floor: Math.floor, ceil: Math.ceil, cbrt: Math.cbrt,
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E, g: 9.80665 };

export function evaluate(expr: string, vars: Record<string, number> = {}): number {
  const src = expr.replace(/×/g, "*").replace(/÷/g, "/").replace(/\*\*/g, "^").replace(/\s+/g, "");
  let i = 0;
  const peek = () => src[i];
  const next = () => src[i++];
  function parseExpr(): number {
    let v = parseTerm();
    while (peek() === "+" || peek() === "-") { const op = next(); const r = parseTerm(); v = op === "+" ? v + r : v - r; }
    return v;
  }
  function parseTerm(): number {
    let v = parseFactor();
    while (peek() === "*" || peek() === "/" || peek() === "%") { const op = next(); const r = parseFactor(); v = op === "*" ? v * r : op === "/" ? v / r : v % r; }
    return v;
  }
  function parseFactor(): number {
    let base = parseUnary();
    if (peek() === "^") { next(); const exp = parseFactor(); base = Math.pow(base, exp); }
    return base;
  }
  function parseUnary(): number {
    if (peek() === "-") { next(); return -parseUnary(); }
    if (peek() === "+") { next(); return parseUnary(); }
    return parsePrimary();
  }
  function parsePrimary(): number {
    if (peek() === "(") { next(); const v = parseExpr(); if (next() !== ")") throw new Error("Expected )"); return v; }
    const m = /^[0-9]*\.?[0-9]+(e[+-]?[0-9]+)?/i.exec(src.slice(i));
    if (m) { i += m[0].length; return parseFloat(m[0]); }
    const id = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(src.slice(i));
    if (id) {
      i += id[0].length;
      const name = id[0];
      if (peek() === "(") {
        next();
        const args: number[] = [];
        if (peek() !== ")") { args.push(parseExpr()); while (peek() === ",") { next(); args.push(parseExpr()); } }
        if (next() !== ")") throw new Error("Expected ) after function args");
        const f = FUNCS[name];
        if (!f) throw new Error(`Unknown function ${name}`);
        return f(...args);
      }
      if (name in vars) return vars[name];
      if (name in CONSTS) return CONSTS[name];
      throw new Error(`Unknown variable ${name}`);
    }
    throw new Error(`Unexpected token at position ${i}: "${src.slice(i, i + 10)}"`);
  }
  const v = parseExpr();
  if (i < src.length) throw new Error(`Unexpected trailing input: "${src.slice(i)}"`);
  return v;
}
