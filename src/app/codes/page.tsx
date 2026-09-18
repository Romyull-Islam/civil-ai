"use client";
import { useMemo, useState } from "react";
import { BookOpen, Search } from "lucide-react";
import { CODE_CLAUSES, searchCodes } from "@/lib/eng/codes";

export default function CodesPage() {
  const [q, setQ] = useState("");
  const [code, setCode] = useState("");
  const codes = useMemo(() => Array.from(new Set(CODE_CLAUSES.map((c) => c.code))).sort(), []);
  const results = useMemo(() => (q.trim() ? searchCodes(q, { code: code || undefined, limit: 30 }) : CODE_CLAUSES.filter((c) => !code || c.code === code).map((c) => ({ ...c, score: 0 }))), [q, code]);
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-4 grid gap-4">
        <div className="flex items-center gap-2"><BookOpen className="text-accent" /><h1 className="text-lg font-semibold">Code library</h1><span className="badge">{CODE_CLAUSES.length} clause summaries</span></div>
        <p className="text-sm text-muted">Built-in summaries of frequently used provisions from India (IS 456/800/875/1893, NBC 2016), Bangladesh (BNBC 2020, RAJUK), China (GB 50010/50009/50011/50007, GB 55001), USA (ACI 318-19, ASCE 7) and Europe (EN 1990/1991/1992) — always verify against the official text. The Assistant searches this library and cites the clause.</p>
        <div className="flex gap-2">
          <div className="relative flex-1"><Search size={16} className="absolute left-2.5 top-2.5 text-muted" /><input className="input pl-8" placeholder="e.g. stirrup spacing, punching shear, load combination…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <select className="select w-48" value={code} onChange={(e) => setCode(e.target.value)}><option value="">All codes</option>{codes.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        </div>
        <div className="grid gap-2">
          {results.map((c) => (
            <div key={c.id} className="card p-3">
              <div className="flex flex-wrap items-center gap-2 text-xs"><span className="badge">{c.code}</span><span className="text-muted">cl. {c.clause}</span><span className="font-medium text-fg">{c.topic}</span></div>
              <p className="text-sm mt-1.5">{c.text}</p>
            </div>
          ))}
          {!results.length && <div className="text-sm text-muted">No matches. Try other words (e.g. “cover”, “shear”, “deflection”).</div>}
        </div>
      </div>
    </div>
  );
}
