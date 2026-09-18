"use client";
import { useMemo, useState } from "react";
import { BookOpen, Search } from "lucide-react";
import { CODE_CLAUSES, searchCodes, COUNTRY_ORDER, countryOf, countryRank } from "@/lib/eng/codes";

export default function CodesPage() {
  const [q, setQ] = useState("");
  const [country, setCountry] = useState("");
  const [code, setCode] = useState("");
  const codes = useMemo(() => Array.from(new Set(CODE_CLAUSES.filter((c) => !country || countryOf(c.code) === country).map((c) => c.code))).sort((a, b) => countryRank(a) - countryRank(b) || a.localeCompare(b)), [country]);
  const results = useMemo(() => {
    const base = q.trim() ? searchCodes(q, { code: code || undefined, country: country || undefined, limit: 50 }) : CODE_CLAUSES.filter((c) => (!code || c.code === code) && (!country || countryOf(c.code) === country)).map((c) => ({ ...c, score: 0 }));
    return q.trim() ? base : [...base].sort((a, b) => countryRank(a.code) - countryRank(b.code));
  }, [q, code, country]);
  const groups = useMemo(() => { const g = new Map<string, typeof results>(); for (const r of results) { const k = countryOf(r.code); g.set(k, [...(g.get(k) ?? []), r]); } return [...COUNTRY_ORDER].filter((k) => g.has(k)).map((k) => [k, g.get(k)!] as const); }, [results]);
  const counts = useMemo(() => Object.fromEntries(COUNTRY_ORDER.map((k) => [k, CODE_CLAUSES.filter((c) => countryOf(c.code) === k).length])), []);
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-4 grid gap-4">
        <div className="flex items-center gap-2"><BookOpen className="text-accent" /><h1 className="text-lg font-semibold">Code library</h1><span className="badge">{CODE_CLAUSES.length} clause summaries</span></div>
        <p className="text-sm text-muted">Summaries of frequently used provisions, grouped by country: Bangladesh (BNBC 2020, RAJUK), India (IS codes, NBC 2016), China (GB), USA (ACI, ASCE), Pakistan (BCP), Nepal (NBC), Europe (Eurocodes). Always verify against the official text; the Assistant cites the clause it used.</p>
        <div className="flex flex-wrap gap-2">
          <button className={`btn btn-sm ${!country ? "btn-primary" : ""}`} onClick={() => { setCountry(""); setCode(""); }}>All countries</button>
          {COUNTRY_ORDER.filter((k) => counts[k]).map((k) => <button key={k} className={`btn btn-sm ${country === k ? "btn-primary" : ""}`} onClick={() => { setCountry(k); setCode(""); }}>{k} <span className="text-muted">({counts[k]})</span></button>)}
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1"><Search size={16} className="absolute left-2.5 top-2.5 text-muted" /><input className="input pl-8" placeholder="e.g. stirrup spacing, punching shear, seismic zone, setback…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <select className="select w-56" value={code} onChange={(e) => setCode(e.target.value)}><option value="">All codes</option>{codes.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        </div>
        {groups.map(([k, list]) => (
          <section key={k} className="grid gap-2">
            <h2 className="font-medium text-sm text-muted uppercase tracking-wide border-b border-border pb-1">{k}</h2>
            {list.map((c) => (
              <div key={c.id} className="card p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs"><span className="badge">{c.code}</span><span className="text-muted">cl. {c.clause}</span><span className="font-medium text-fg">{c.topic}</span></div>
                <p className="text-sm mt-1.5">{c.text}</p>
              </div>
            ))}
          </section>
        ))}
        {!results.length && <div className="text-sm text-muted">No matches. Try other words (e.g. “cover”, “shear”, “deflection”).</div>}
      </div>
    </div>
  );
}
