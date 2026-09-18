"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Users, UserPlus, UserMinus } from "lucide-react";

interface TeamInfo { team: { id: string; name: string; plan: string; seats: number; expires: number | null }; members: { id: string; email: string; name: string }[]; owner: boolean; plan?: { name: string } }

export default function TeamPage() {
  const [t, setT] = useState<TeamInfo | null | undefined>(undefined); const [email, setEmail] = useState(""); const [err, setErr] = useState<string | null>(null);
  const load = () => fetch("/api/team").then((r) => r.json()).then((j) => setT(j.team ?? null)).catch(() => setT(null));
  useEffect(() => { load(); }, []);
  const act = async (body: Record<string, string>) => { setErr(null); const r = await fetch("/api/team", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const j = await r.json(); if (!r.ok) { setErr(j.error); return; } setEmail(""); setT(j.team); };
  if (t === undefined) return <div className="p-6 text-sm text-muted">Loading…</div>;
  return (
    <div className="h-full overflow-y-auto"><div className="max-w-2xl mx-auto p-6 grid gap-4">
      <div className="flex items-center gap-2"><Users className="text-accent" /><h1 className="text-lg font-semibold">Team</h1></div>
      {!t ? <div className="card p-4 text-sm">You are not in a team. The <b>Team / Enterprise</b> plan gives every member Max-level features for one per-user price. <Link className="text-accent2" href="/pricing">See plans</Link>.</div> : (
        <>
          <div className="card p-4 text-sm grid gap-1">
            <div className="font-medium">{t.team.name}</div>
            <div className="text-muted">Plan {t.plan?.name ?? t.team.plan} · {t.members.length} of {t.team.seats} seats used{t.team.expires ? ` · active until ${new Date(t.team.expires).toLocaleDateString()}` : ""}</div>
            {t.owner && <div className="text-xs text-muted">You are the owner. Members must have a CivilMate account (free sign-up) before you add them. Need more seats? <Link className="text-accent2" href={`/subscribe?plan=${t.team.plan}`}>Buy seats / renew</Link>.</div>}
          </div>
          <div className="card p-4 text-sm grid gap-2">
            <div className="label">Members</div>
            {t.members.map((m) => <div key={m.id} className="flex items-center gap-2 border-t border-border py-1.5"><span>{m.name || m.email}</span><span className="text-xs text-muted">{m.email}</span>{t.owner && m.id !== t.members[0]?.id && <button className="btn btn-sm ml-auto text-err" onClick={() => act({ action: "remove", userId: m.id })}><UserMinus size={13} /> Remove</button>}</div>)}
            {t.owner && t.members.length < t.team.seats && <div className="flex gap-2 mt-2"><input className="input" type="email" placeholder="member's account email" value={email} onChange={(e) => setEmail(e.target.value)} /><button className="btn btn-primary" onClick={() => act({ action: "add", email })} disabled={!email}><UserPlus size={14} /> Add</button></div>}
            {err && <div className="text-xs text-err">{err}</div>}
          </div>
        </>
      )}
    </div></div>
  );
}
