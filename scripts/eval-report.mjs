#!/usr/bin/env node
/** Regenerates the results table at the end of docs/07-model-evaluation.md from docs/eval-results.json (latest run per provider/model). */
import fs from "node:fs";
const runs = JSON.parse(fs.readFileSync("docs/eval-results.json", "utf8"));
// Merge runs per provider/model: keep the latest result for each task id.
const latest = new Map();
for (const r of runs) {
  const key = `${r.provider}/${r.model ?? ""}`;
  const cur = latest.get(key) ?? { ...r, results: [] };
  for (const x of r.results) { cur.results = cur.results.filter((y) => y.id !== x.id); cur.results.push(x); }
  cur.date = r.date; cur.served = r.served ?? cur.served;
  cur.score = `${cur.results.filter((x) => x.valueOk).length}/${cur.results.length}`;
  cur.avgSeconds = Math.round(cur.results.reduce((s, x) => s + x.seconds, 0) / cur.results.length);
  latest.set(key, cur);
}
const ids = [...new Set(runs.flatMap((r) => r.results.map((x) => x.id)))];
let md = "| Provider / model | Score | Avg s/task | " + ids.join(" | ") + " |\n|---|---|---|" + ids.map(() => "---").join("|") + "|\n";
for (const r of latest.values()) {
  const cell = (id) => { const x = r.results.find((y) => y.id === id); return !x ? "–" : x.valueOk ? "✅" : x.toolsOk ? "⚠️" : "❌"; };
  md += `| ${r.served ?? `${r.provider}/${r.model}`} (${r.date.slice(0, 10)}) | **${r.score}** | ${r.avgSeconds} | ${ids.map(cell).join(" | ")} |\n`;
}
md += "\n✅ correct numbers · ⚠️ right tool, wrong inputs · ❌ no/incorrect tool use. Timings are wall-clock on the build machine (i9-14900K; local model CPU-only, Ollama with its own runtime).\n";
const doc = fs.readFileSync("docs/07-model-evaluation.md", "utf8");
const marker = "<!-- results-table -->";
const base = doc.includes(marker) ? doc.slice(0, doc.indexOf(marker)) : doc;
fs.writeFileSync("docs/07-model-evaluation.md", base + marker + "\n" + md);
console.log(md);
