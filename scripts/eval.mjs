#!/usr/bin/env node
/**
 * Civil-engineering benchmark for any configured provider.
 * Usage: node scripts/eval.mjs --provider local --model qwen3.5-4b [--base http://localhost:3001] [--only beam,units] [--delay 8]
 * Each task sends a realistic engineer request and checks (a) the right tools were called and (b) the numbers
 * in tool outputs match hand-verified answers. Scores are written to docs/eval-results.json.
 */
import fs from "node:fs";
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith("--") ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : "true"] : []).filter(Boolean));
const BASE = args.base ?? "http://localhost:3001";
const provider = args.provider ?? "auto";
const model = args.model;
const keys = args.keys ? JSON.parse(fs.readFileSync(args.keys, "utf8")) : {};

const TASKS = [
  { id: "beam-udl", prompt: "Simply supported beam, 6 m span, 25 kN/m factored UDL. What are the maximum bending moment and shear?", tools: ["analyze_beam"], check: (o, text) => near(o.analyze_beam?.result?.maxMomentPositive?.value, 112.5) && near(Math.abs(o.analyze_beam?.result?.maxShear?.value), 75) && /112\.5/.test(text) && /\b75\b/.test(text) },
  { id: "cantilever", prompt: "A 3 m cantilever carries 10 kN at the free end and 4 kN/m along its length. Give the fixed-end moment and reaction.", tools: ["analyze_beam"], check: (o) => near(Math.abs(o.analyze_beam?.result?.reactions?.MA), 48) && near(o.analyze_beam?.result?.reactions?.RA, 22) },
  { id: "rc-beam", prompt: "Design the tension steel for a 300x500 mm RC beam, clear cover 25 mm, M25 concrete, Fe500 steel, factored moment 112.5 kN·m, factored shear 75 kN, IS 456.", tools: ["design_rc_beam"], check: (o) => near(o.design_rc_beam?.result?.AstRequired, 619, 0.05) },
  { id: "column", prompt: "A short RC column 300x450 mm carries a factored axial load of 1800 kN. M25, Fe500, IS 456. How much longitudinal steel is needed?", tools: ["design_rc_column"], check: (o) => { const a = o.design_rc_column?.result?.AscRequired; return a > 1000 && a < 1500; } },
  { id: "footing", prompt: "Size an isolated square footing for a 400x400 column with 900 kN service load on soil with safe bearing capacity 180 kN/m². M25, Fe500.", tools: ["design_isolated_footing"], check: (o) => near(o.design_isolated_footing?.result?.side, 2.35, 0.03) },
  { id: "slab", prompt: "Design a one-way simply supported slab of 3.5 m span for 3 kN/m² live load, M25/Fe500, IS 456.", tools: ["design_one_way_slab"], check: (o) => { const t = o.design_one_way_slab?.result?.thickness; return t >= 120 && t <= 180; } },
  { id: "concrete-qty", prompt: "How many bags of cement, and how much sand and aggregate, for 12 m³ of M20 concrete?", tools: ["concrete_materials"], check: (o, text) => { const b = o.concrete_materials?.result?.cement?.bags; return b >= 96 && b <= 110 && text.includes(String(b)); } },
  { id: "units", prompt: "Convert 4.5 kN/m² to psf.", tools: ["convert_units"], check: (o) => near(o.convert_units?.result?.value, 93.98, 0.01) },
  { id: "code", prompt: "What is the minimum tension reinforcement for a beam according to IS 456? Cite the clause.", tools: ["search_code_clauses"], check: (o, text) => /26\.5\.1\.1/.test(text) || JSON.stringify(o.search_code_clauses?.result ?? "").includes("26.5.1.1") },
  { id: "bearing", prompt: "Terzaghi safe bearing capacity of a 2 m wide strip footing at 1.5 m depth: c = 10 kPa, φ = 30°, γ = 18 kN/m³, FS = 3.", tools: ["bearing_capacity"], check: (o) => { const q = o.bearing_capacity?.result?.safe; return q > 300 && q < 600; } },
  { id: "house-plan", prompt: "Plan a 2-bedroom house on a 10 m × 12 m plot with 1.5 m front and rear setbacks and 1 m side setbacks: living 20 m², kitchen 8 m², bedrooms 14 and 12 m², bathroom 3 m². Draw it.", tools: ["plan_layout"], check: (o) => { const r = o.plan_layout?.result; return r && r.rooms?.length === 5 && r.checks?.find((c) => c.name.startsWith("Fits"))?.ok === true; } },
  // Common Bangladeshi site questions (textbook answers, feet and bags as engineers ask them)
  { id: "bd-concrete", prompt: "How many bags of cement, cft of sand and cft of stone chips for 100 cft of 1:2:4 (M20) concrete?", tools: ["concrete_materials"], check: (o, text) => o.concrete_materials?.result?.ratio === "1:2:4" && near(o.concrete_materials?.result?.cement?.cft, 22.66, 0.03) && /\b(19|18\.5)\b/.test(text) && /\b(45|44)(\.\d+)?\b/.test(text) },
  { id: "bd-bricks", prompt: "How many bricks are needed for a 10 inch brick wall, 20 ft long and 10 ft high?", tools: ["masonry_and_finishes"], check: (o, text) => { const b = o.masonry_and_finishes?.result?.brickwork; return b?.brickType === "bd_standard" && b.bricks >= 1950 && b.bricks <= 2100 && text.replace(/,/g, "").includes(String(b.bricks)); } },
  { id: "bd-land", prompt: "5 katha land is how many square feet and how many decimal?", tools: ["convert_units"], check: (_o, text) => /3,?600/.test(text) && /8\.2[0-9]/.test(text) },
  { id: "bd-rod", prompt: "What is the total weight of 20 pieces of 12 mm rod, each 40 ft long?", tools: ["rebar_schedule"], check: (o, text) => near(o.rebar_schedule?.result?.totalKg, 216.5, 0.02) && /21[67](\.\d)?\s*kg/.test(text) },
  { id: "bd-house", prompt: "Plan a 2-storey house on a 5 katha plot (40 ft × 90 ft) in Dhaka with 3 bedrooms, a garage and dining; show coverage and FAR.", tools: ["plan_building"], check: (o, text) => { const r = o.plan_building?.result; return r?.floors?.length === 2 && r.checks?.every((c) => c.ok) && /FAR/i.test(text) && /coverage/i.test(text); } },
  { id: "imp-footing", prompt: "Size an isolated square footing for a 15\"×15\" column carrying 120 kip service load; allowable bearing 2 ksf; 3000 psi concrete, Grade 60 steel, ACI 318.", tools: ["design_isolated_footing"], check: (o) => { const s = o.design_isolated_footing?.result?.side; return s >= 2.4 && s <= 2.6; } },
  { id: "imp-cantilever", prompt: "A 4 m cantilever carries a 15 kN point load at the tip and a 5 kN/m UDL over its length. What are the fixed-end moment and reaction?", tools: ["analyze_beam"], check: (o, text) => near(Math.abs(o.analyze_beam?.result?.reactions?.MA), 100) && near(o.analyze_beam?.result?.reactions?.RA, 35) && /\b100\b/.test(text) && /\b35\b/.test(text) },
  { id: "retaining", prompt: "Active earth pressure on a 4 m high retaining wall with backfill φ = 30° and γ = 18 kN/m³ (Rankine). Give the total thrust and where it acts.", tools: ["earth_pressure"], check: (o, text) => near(o.earth_pressure?.result?.activeForce, 48) && /\b48\b/.test(text) && /1\.33/.test(text) },
  { id: "earthwork", prompt: "Road cutting: cross-section areas 12, 15 and 18 m² at 10 m intervals. Volume of cut by the average end area method?", tools: ["earthwork_volume"], check: (o, text) => near(o.earthwork_volume?.result?.volume, 300) && /\b300\b/.test(text) },
  { id: "drawing", prompt: "Draw an RC beam section 300x500 with 4 Ø16 bottom bars, 2 Ø12 top bars and Ø8 stirrups at 150 mm.", tools: ["draw_beam_section"], check: (o) => o.draw_beam_section?.result?.entities > 5 },
];
const near = (a, b, tol = 0.02) => typeof a === "number" && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

async function run(task) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", parts: [{ type: "text", text: task.prompt }] }], provider, model, keys }) });
  const raw = await res.text();
  const evs = raw.split("\n").filter((l) => l.startsWith("data: ")).map((l) => { try { return JSON.parse(l.slice(6)); } catch { return null; } }).filter(Boolean);
  const outputs = {}; const called = []; const notices = []; let text = ""; let error = null; let served = ""; let usage = null;
  for (const e of evs) {
    if (e.type === "tool_call") called.push(e.name);
    if (e.type === "tool_result" && !e.output.error) outputs[e.name] = e.output;
    if (e.type === "text") text += e.delta;
    if (e.type === "text_replace") text = e.text;
    if (e.type === "error") error = e.message;
    if (e.type === "notice") notices.push(e.message);
    if (e.type === "done") { served = `${e.provider}/${e.model}`; usage = e.usage; }
  }
  const toolsOk = task.tools.every((t) => called.includes(t));
  let valueOk = false; try { valueOk = !!task.check(outputs, text); } catch { valueOk = false; }
  // The agent re-checks every figure in the final answer against tool output; a remaining warning means invented numbers.
  const grounded = !notices.some((n) => /did not come from a calculation/.test(n));
  const retried = notices.some((n) => /Double-checking/.test(n));
  const answered = text.trim().length > 40;
  return { id: task.id, seconds: Math.round((Date.now() - t0) / 1000), ok: valueOk && grounded && answered, tokens: usage ? { input: usage.input, output: usage.output } : null, toolsOk, valueOk, grounded, retried, called, error, served, answered };
}

const only = args.only ? args.only.split(",") : null;
const results = [];
for (const task of TASKS.filter((t) => !only || only.includes(t.id))) {
  if (results.length && args.delay) await new Promise((res) => setTimeout(res, Number(args.delay) * 1000));
  const r = await run(task);
  results.push(r);
  const why = [!r.answered && "no answer", !r.grounded && "invented figures", r.retried && "self-corrected", r.error && "error=" + r.error.slice(0, 80)].filter(Boolean).join(", ");
  console.log(`${r.ok ? "PASS" : r.toolsOk ? "PARTIAL" : "FAIL"}  ${r.id.padEnd(14)} ${String(r.seconds).padStart(4)}s  tools=${r.called.join(",") || "-"}${why ? "  (" + why + ")" : ""}`);
}
const score = results.filter((r) => r.ok).length;
const withTokens = results.filter((r) => r.tokens);
const avgTokens = withTokens.length ? { input: Math.round(withTokens.reduce((s, r) => s + r.tokens.input, 0) / withTokens.length), output: Math.round(withTokens.reduce((s, r) => s + r.tokens.output, 0) / withTokens.length) } : null;
const summary = { provider, model, served: results[0]?.served, date: new Date().toISOString(), score: `${score}/${results.length}`, avgSeconds: Math.round(results.reduce((s, r) => s + r.seconds, 0) / results.length), avgTokens, results };
console.log(`\nScore ${summary.score} correct · avg ${summary.avgSeconds}s per task · ${avgTokens ? `avg ${avgTokens.input} in / ${avgTokens.output} out tokens · ` : ""}${summary.served}`);
const file = args.out ?? "docs/eval-results.json";
const all = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
all.push(summary);
fs.writeFileSync(file, JSON.stringify(all, null, 2));
