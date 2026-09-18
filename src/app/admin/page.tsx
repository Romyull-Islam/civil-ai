"use client";
import { useEffect, useState } from "react";
import { Shield, KeyRound, Users, BarChart3, Layers, Save, RefreshCw, Wallet, LifeBuoy, Globe } from "lucide-react";
import type { SiteSettings } from "@/lib/saas/site";
import { PROVIDERS } from "@/lib/ai/registry";
import { DEFAULT_PLANS } from "@/lib/saas/plans";
import { useSession } from "@/lib/client/session";
import type { Plan } from "@/lib/saas/plans";

type Tab = "users" | "keys" | "plans" | "usage" | "payments" | "support" | "site" | "gateways" | "teams";
type Role = "superadmin" | "admin" | "support" | "user";
interface AdminUser { id: string; email: string; name: string; role: Role; plan: string; planExpires: number | null; createdAt: number; disabled: number }
const TAB_ROLES: Record<Tab, Role[]> = { gateways: ["superadmin", "admin"], teams: ["superadmin", "admin", "support"], users: ["superadmin", "admin", "support"], payments: ["superadmin", "admin", "support"], support: ["superadmin", "admin", "support"], keys: ["superadmin", "admin"], plans: ["superadmin", "admin"], site: ["superadmin", "admin"], usage: ["superadmin", "admin"] };

export default function AdminPage() {
  const s = useSession();
  const [tab, setTab] = useState<Tab>("users");
  if (!s) return <div className="p-6 text-sm text-muted">Loading…</div>;
  const role = s.user?.role ?? "user";
  if (s.mode !== "saas" || role === "user") return <div className="p-6 text-sm text-err">Staff access only.</div>;
  const tabs = ([["users", Users, "Users & subscriptions"], ["teams", Users, "Teams"], ["payments", Wallet, "Payments"], ["support", LifeBuoy, "Support tickets"], ["keys", KeyRound, "Provider API keys"], ["gateways", Wallet, "Payment gateways"], ["plans", Layers, "Plans"], ["site", Globe, "Site & payment settings"], ["usage", BarChart3, "Usage"]] as const).filter(([id]) => TAB_ROLES[id].includes(role));
  return (
    <div className="h-full overflow-y-auto"><div className="max-w-6xl mx-auto p-4 grid gap-4">
      <div className="flex items-center gap-2"><Shield className="text-accent" /><h1 className="text-lg font-semibold">{role === "support" ? "Helpdesk" : "Admin"}</h1><span className="badge">{role}</span></div>
      <div className="flex gap-2 flex-wrap">{tabs.map(([id, Icon, label]) => <button key={id} className={`btn btn-sm ${tab === id ? "btn-primary" : ""}`} onClick={() => setTab(id)}><Icon size={14} /> {label}</button>)}</div>
      {tab === "users" && <UsersTab me={s.user!} />}{tab === "teams" && <TeamsTab />}{tab === "payments" && <PaymentsTab />}{tab === "support" && <SupportTab />}{tab === "keys" && <KeysTab />}{tab === "gateways" && <GatewaysTab />}{tab === "plans" && <PlansTab />}{tab === "site" && <SiteTab />}{tab === "usage" && <UsageTab />}
    </div></div>
  );
}

function UsersTab({ me }: { me: { id: string; role: Role } }) {
  const [users, setUsers] = useState<AdminUser[]>([]); const [plans, setPlans] = useState<Plan[]>([]); const [q, setQ] = useState("");
  const [nu, setNu] = useState({ email: "", password: "", role: "support" as Role, name: "" }); const [nuErr, setNuErr] = useState<string | null>(null);
  const superadmin = me.role === "superadmin";
  const create = async () => { setNuErr(null); const r = await fetch("/api/admin/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nu) }); const j = await r.json(); if (!r.ok) { setNuErr(j.error); return; } setNu({ email: "", password: "", role: "support", name: "" }); load(); };
  const remove = async (u: AdminUser) => { if (!confirm(`Delete ${u.email} (${u.role})? This cannot be undone.`)) return; await fetch("/api/admin/users", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: u.id }) }); load(); };
  const load = () => fetch("/api/admin/users").then((r) => r.json()).then((j) => { setUsers(j.users ?? []); setPlans(j.plans ?? []); });
  useEffect(() => { load(); }, []);
  const patch = async (id: string, body: Record<string, unknown>) => { await fetch("/api/admin/users", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...body }) }); load(); };
  const list = users.filter((u) => !q || u.email.includes(q) || u.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="card p-4 grid gap-3">
      <div className="flex items-center gap-2"><input className="input max-w-xs" placeholder="search email / name" value={q} onChange={(e) => setQ(e.target.value)} /><span className="text-xs text-muted">{users.length} users</span><button className="btn btn-sm ml-auto" onClick={load}><RefreshCw size={13} /></button></div>
      <p className="text-xs text-muted">Set a user&apos;s plan after they pay (manual subscription management). Expiry date is optional; after it passes the user drops to Free automatically.{superadmin ? " As superadmin you can also create staff accounts (admin = full operations incl. API keys and plans; support = helpdesk: tickets, payments, user plans) and change or delete accounts." : " Role changes and account deletion are reserved for the superadmin."}</p>
      {superadmin && (
        <div className="border border-border rounded-lg p-3 grid sm:grid-cols-5 gap-2 items-end">
          <div className="sm:col-span-5 label">Create account</div>
          <input className="input" placeholder="name" value={nu.name} onChange={(e) => setNu({ ...nu, name: e.target.value })} />
          <input className="input" placeholder="email" value={nu.email} onChange={(e) => setNu({ ...nu, email: e.target.value })} />
          <input className="input" placeholder="temporary password (8+)" value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} />
          <select className="select" value={nu.role} onChange={(e) => setNu({ ...nu, role: e.target.value as Role })}><option value="support">support (helpdesk)</option><option value="admin">admin (operations)</option><option value="superadmin">superadmin</option><option value="user">user</option></select>
          <button className="btn btn-primary" onClick={create} disabled={!nu.email || nu.password.length < 8}>Create</button>
          {nuErr && <div className="sm:col-span-5 text-xs text-err">{nuErr}</div>}
        </div>
      )}
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-muted"><th className="py-1">User</th><th>Role</th><th>Plan</th><th>Expires</th><th>Joined</th><th>Status</th></tr></thead>
        <tbody>{list.map((u) => (
          <tr key={u.id} className="border-t border-border">
            <td className="py-1.5">{u.name || "—"}<div className="text-xs text-muted">{u.email}</div></td>
            <td>{superadmin && u.id !== me.id ? <select className="select !w-auto !py-0.5" value={u.role} onChange={(e) => patch(u.id, { role: e.target.value })}><option value="user">user</option><option value="support">support</option><option value="admin">admin</option><option value="superadmin">superadmin</option></select> : <span className="badge">{u.role}</span>}</td>
            <td><select className="select !w-auto !py-0.5" value={u.plan} onChange={(e) => patch(u.id, { plan: e.target.value })}>{plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></td>
            <td><input className="input !w-40 !py-0.5" type="date" value={u.planExpires ? new Date(u.planExpires).toISOString().slice(0, 10) : ""} onChange={(e) => patch(u.id, { planExpires: e.target.value ? new Date(e.target.value).getTime() : null })} /></td>
            <td className="text-xs text-muted">{new Date(u.createdAt).toLocaleDateString()}</td>
            <td className="whitespace-nowrap">{u.id !== me.id && <button className={`btn btn-sm ${u.disabled ? "text-ok" : "text-err"}`} onClick={() => patch(u.id, { disabled: u.disabled ? 0 : 1 })}>{u.disabled ? "enable" : "disable"}</button>} {superadmin && u.id !== me.id && <button className="btn btn-sm text-err" onClick={() => remove(u)}>delete</button>}</td>
          </tr>))}</tbody>
      </table></div>
    </div>
  );
}

function KeysTab() {
  const [status, setStatus] = useState<Record<string, { set: boolean; fromEnv: boolean; baseUrl?: string }>>({});
  const [draft, setDraft] = useState<Record<string, { apiKey?: string; baseUrl?: string }>>({});
  const load = () => fetch("/api/admin/keys").then((r) => r.json()).then(setStatus);
  useEffect(() => { load(); }, []);
  const save = async (p: string, clear = false) => { await fetch("/api/admin/keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: p, apiKey: clear ? "" : draft[p]?.apiKey, baseUrl: draft[p]?.baseUrl }) }); setDraft((d) => ({ ...d, [p]: {} })); load(); };
  return (
    <div className="grid gap-3">
      <p className="text-xs text-muted">Keys are encrypted at rest with the server secret (set <code>CIVIL_AI_SECRET</code> in production) and never sent to users. Environment variables are used as fallback when no key is stored here.</p>
      {PROVIDERS.filter((p) => p.requiresKey && p.id !== "local").map((p) => (
        <div key={p.id} className="card p-3 grid sm:grid-cols-[180px_1fr_auto] gap-2 items-center">
          <div><div className="font-medium text-sm">{p.label}</div><div className="text-xs text-muted">{status[p.id]?.set ? "stored key ✓" : status[p.id]?.fromEnv ? "from env ✓" : "no key"}</div></div>
          <div className="grid gap-1">
            <input className="input" type="password" placeholder={status[p.id]?.set ? "•••••••• (stored) — paste to replace" : "paste API key"} value={draft[p.id]?.apiKey ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [p.id]: { ...d[p.id], apiKey: e.target.value } }))} autoComplete="off" />
            {(p.baseUrlEnv || p.baseUrl) && <input className="input" placeholder={`base URL (default ${p.baseUrl ?? "—"})`} value={draft[p.id]?.baseUrl ?? status[p.id]?.baseUrl ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [p.id]: { ...d[p.id], baseUrl: e.target.value } }))} />}
          </div>
          <div className="flex gap-1"><button className="btn btn-sm" onClick={() => save(p.id)} disabled={!draft[p.id]?.apiKey && draft[p.id]?.baseUrl === undefined}><Save size={13} /> Save</button>{status[p.id]?.set && <button className="btn btn-sm text-err" onClick={() => save(p.id, true)}>Clear</button>}</div>
        </div>
      ))}
    </div>
  );
}

function PlansTab() {
  const [plans, setPlans] = useState<Plan[]>([]); const [keys, setKeys] = useState<Record<string, { set: boolean; fromEnv: boolean }>>({}); const [err, setErr] = useState<string | null>(null); const [ok, setOk] = useState(false); const [raw, setRaw] = useState(false); const [text, setText] = useState("");
  const load = () => Promise.all([fetch("/api/admin/plans").then((r) => r.json()), fetch("/api/admin/keys").then((r) => r.json())]).then(([p, k]) => { setPlans(p.plans); setText(JSON.stringify(p.plans, null, 2)); setKeys(k); });
  useEffect(() => { load(); }, []);
  const save = async (list: Plan[]) => { setErr(null); const r = await fetch("/api/admin/plans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plans: list }) }); const j = await r.json(); if (!r.ok) { setErr(j.error); return; } setPlans(j.plans); setText(JSON.stringify(j.plans, null, 2)); setOk(true); setTimeout(() => setOk(false), 1500); };
  const upd = (i: number, patch: Partial<Plan>) => setPlans(plans.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const toggleModel = (i: number, provider: string, model: string) => {
    const p = plans[i]; const prov = p.providers.find((x) => x.provider === provider);
    let providers = p.providers.map((x) => ({ ...x, models: [...x.models] }));
    if (!prov) providers.push({ provider, models: [model] });
    else { const idx = providers.findIndex((x) => x.provider === provider); const has = providers[idx].models.includes(model); providers[idx].models = has ? providers[idx].models.filter((m) => m !== model) : [...providers[idx].models, model]; if (!providers[idx].models.length) providers = providers.filter((_, k) => k !== idx); }
    upd(i, { providers });
  };
  const addPlan = () => setPlans([...plans, { id: `plan${plans.length + 1}`, name: "New plan", priceMonthly: 0, priceUSD: 0, currency: "BDT", dailyRequests: 50, vision: false, localAI: false, periodDays: 30, graceDays: 3, providers: [], features: [] }]);
  return (
    <div className="grid gap-3">
      <p className="text-xs text-muted">Each plan lists which models its subscribers can choose in the chat selector (the first ticked model of the first provider is the default). Providers marked <span className="text-err">no key</span> will not work until a key is added in <b>Provider API keys</b>. Prices are in the plan currency (৳ BDT); the USD price is used by Stripe. <button className="text-accent2" onClick={() => setRaw(!raw)}>{raw ? "Visual editor" : "Edit as JSON"}</button></p>
      {raw ? (
        <div className="card p-4 grid gap-2"><textarea className="textarea font-mono text-xs min-h-96" value={text} onChange={(e) => setText(e.target.value)} /><div className="flex gap-2"><button className="btn btn-primary" onClick={() => { try { save(JSON.parse(text)); } catch (e) { setErr((e as Error).message); } }}><Save size={14} /> Save JSON</button><button className="btn" onClick={() => setText(JSON.stringify(DEFAULT_PLANS, null, 2))}>Load defaults</button></div></div>
      ) : plans.map((p, i) => (
        <div key={i} className="card p-4 grid gap-3 text-sm">
          <div className="grid sm:grid-cols-4 gap-2">
            <div><label className="label">ID</label><input className="input mt-1" value={p.id} onChange={(e) => upd(i, { id: e.target.value.replace(/[^a-z0-9_-]/gi, "").toLowerCase() })} /></div>
            <div><label className="label">Name</label><input className="input mt-1" value={p.name} onChange={(e) => upd(i, { name: e.target.value })} /></div>
            <div><label className="label">Price / period ({p.currency})</label><input className="input mt-1" type="number" value={p.priceMonthly} onChange={(e) => upd(i, { priceMonthly: Number(e.target.value) })} /></div>
            <div><label className="label">Price USD (Stripe)</label><input className="input mt-1" type="number" step="0.1" value={p.priceUSD ?? 0} onChange={(e) => upd(i, { priceUSD: Number(e.target.value) })} /></div>
            <div><label className="label">AI requests / day</label><input className="input mt-1" type="number" value={p.dailyRequests} onChange={(e) => upd(i, { dailyRequests: Number(e.target.value) })} /></div>
            <div><label className="label">Period (days)</label><input className="input mt-1" type="number" value={p.periodDays ?? 30} onChange={(e) => upd(i, { periodDays: Number(e.target.value) })} /></div>
            <div><label className="label">Grace (days)</label><input className="input mt-1" type="number" value={p.graceDays ?? 3} onChange={(e) => upd(i, { graceDays: Number(e.target.value) })} /></div>
            <div><label className="label">Per-seat team plan?</label><select className="select mt-1" value={p.perSeat ? "yes" : "no"} onChange={(e) => upd(i, { perSeat: e.target.value === "yes", minSeats: p.minSeats ?? 3 })}><option value="no">No (single user)</option><option value="yes">Yes (price × seats)</option></select></div>
            {p.perSeat && <div><label className="label">Minimum seats</label><input className="input mt-1" type="number" value={p.minSeats ?? 3} onChange={(e) => upd(i, { minSeats: Number(e.target.value) })} /></div>}
            <div className="flex items-center gap-4 pt-5"><label className="flex items-center gap-1"><input type="checkbox" checked={p.vision} onChange={(e) => upd(i, { vision: e.target.checked })} /> image input</label><label className="flex items-center gap-1"><input type="checkbox" checked={p.localAI} onChange={(e) => upd(i, { localAI: e.target.checked })} /> offline model (desktop)</label></div>
          </div>
          <div><label className="label">Models available to subscribers</label>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-1">
              {PROVIDERS.filter((pr) => pr.id !== "local" && pr.id !== "ollama").map((pr) => (
                <div key={pr.id} className="border border-border rounded-lg p-2">
                  <div className="text-xs font-medium flex items-center gap-2">{pr.label}{keys[pr.id] && !(keys[pr.id].set || keys[pr.id].fromEnv) && <span className="text-err">no key</span>}</div>
                  {pr.models.map((m) => <label key={m.id} className="flex items-center gap-1 text-xs mt-1"><input type="checkbox" checked={!!p.providers.find((x) => x.provider === pr.id)?.models.includes(m.id)} onChange={() => toggleModel(i, pr.id, m.id)} /> {m.label}{m.note ? <span className="text-muted"> — {m.note}</span> : null}</label>)}
                </div>
              ))}
            </div>
          </div>
          <div><label className="label">Features (one per line, shown on the Plans page)</label><textarea className="textarea mt-1 min-h-20" value={p.features.join("\n")} onChange={(e) => upd(i, { features: e.target.value.split("\n").filter(Boolean) })} /></div>
          <div className="flex gap-2"><button className="btn btn-sm text-err" onClick={() => setPlans(plans.filter((_, j) => j !== i))} disabled={p.id === "free"}>Remove plan</button></div>
        </div>
      ))}
      {!raw && <div className="flex gap-2 items-center"><button className="btn btn-primary" onClick={() => save(plans)}><Save size={14} /> Save plans</button><button className="btn" onClick={addPlan}>Add plan</button><button className="btn" onClick={() => setPlans(DEFAULT_PLANS)}>Load defaults</button>{ok && <span className="text-xs text-ok">saved</span>}</div>}
      {err && <div className="text-xs text-err">{err}</div>}
    </div>
  );
}

function UsageTab() {
  const [rem, setRem] = useState<string | null>(null);
  const runReminders = async () => { const r = await fetch("/api/cron/renewals"); const j = await r.json(); setRem(r.ok ? `Checked ${j.checked} accounts, sent ${j.sent.length} reminder(s)${j.sent.length ? ": " + j.sent.join(", ") : ""}` : j.error); };
  const [data, setData] = useState<{ byDay: { day: string; requests: number; inputTokens: number; outputTokens: number }[]; byUser: { email: string; requests: number; inputTokens: number; outputTokens: number }[]; users: number } | null>(null);
  useEffect(() => { fetch("/api/admin/usage?days=30").then((r) => r.json()).then(setData); }, []);
  if (!data) return <div className="text-sm text-muted">Loading…</div>;
  const reminders = <div className="card p-4 md:col-span-2 text-sm"><div className="font-medium">Renewal reminders</div><p className="text-xs text-muted">Emails go out 7 days and 1 day before expiry and when the grace period starts (automatically once a day; on Vercel via the cron job). You can run the check now.</p><button className="btn btn-sm mt-2" onClick={runReminders}>Run reminders now</button>{rem && <div className="text-xs mt-1">{rem}</div>}</div>;
  const tot = data.byDay.reduce((a, d) => ({ r: a.r + d.requests, t: a.t + d.inputTokens + d.outputTokens }), { r: 0, t: 0 });
  return (
    <div className="grid md:grid-cols-2 gap-3">
      {reminders}
      <div className="card p-4"><div className="label">Last 30 days</div><div className="text-2xl font-semibold mt-1">{tot.r} requests</div><div className="text-sm text-muted">{(tot.t / 1e6).toFixed(2)} M tokens · {data.users} users</div>
        <table className="w-full text-xs mt-3"><thead><tr className="text-left text-muted"><th>Day</th><th>Requests</th><th>Tokens</th></tr></thead><tbody>{data.byDay.map((d) => <tr key={d.day} className="border-t border-border"><td className="py-0.5">{d.day}</td><td>{d.requests}</td><td>{d.inputTokens + d.outputTokens}</td></tr>)}</tbody></table></div>
      <div className="card p-4"><div className="label">Top users</div>
        <table className="w-full text-xs mt-2"><thead><tr className="text-left text-muted"><th>User</th><th>Requests</th><th>Tokens</th></tr></thead><tbody>{data.byUser.map((u) => <tr key={u.email} className="border-t border-border"><td className="py-0.5">{u.email}</td><td>{u.requests}</td><td>{u.inputTokens + u.outputTokens}</td></tr>)}</tbody></table></div>
    </div>
  );
}

function PaymentsTab() {
  const [list, setList] = useState<{ id: string; email: string; plan: string; method: string; amount: number; currency: string; txnId: string; sender: string; status: string; note: string; createdAt: number }[]>([]);
  const [filter, setFilter] = useState("pending");
  const load = () => fetch(`/api/admin/payments${filter ? `?status=${filter}` : ""}`).then((r) => r.json()).then((j) => setList(j.payments ?? []));
  useEffect(() => { load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);
  const review = async (id: string, status: "approved" | "rejected") => { const note = status === "rejected" ? (prompt("Reason (sent to the user):") ?? "") : ""; await fetch("/api/admin/payments", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status, note }) }); load(); };
  return (
    <div className="card p-4 grid gap-3">
      <div className="flex items-center gap-2"><select className="select !w-auto" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="">All</option></select><span className="text-xs text-muted">Check the transaction in your bKash/Nagad/Rocket/bank app, then approve. Approving sets the plan and extends the expiry by the plan period.</span><button className="btn btn-sm ml-auto" onClick={load}><RefreshCw size={13} /></button></div>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-muted"><th>Date</th><th>User</th><th>Plan</th><th>Method</th><th>Amount</th><th>TrxID</th><th>Sender</th><th>Status</th><th></th></tr></thead>
        <tbody>{list.map((p) => <tr key={p.id} className="border-t border-border"><td className="py-1.5 text-xs">{new Date(p.createdAt).toLocaleString()}</td><td className="text-xs">{p.email}</td><td>{p.plan}</td><td>{p.method}</td><td>{p.amount} {p.currency}</td><td className="font-mono text-xs">{p.txnId}</td><td className="text-xs">{p.sender}</td><td>{p.status}{p.note ? <div className="text-xs text-muted">{p.note}</div> : null}</td><td className="whitespace-nowrap">{p.status === "pending" && <><button className="btn btn-sm text-ok" onClick={() => review(p.id, "approved")}>Approve</button> <button className="btn btn-sm text-err" onClick={() => review(p.id, "rejected")}>Reject</button></>}</td></tr>)}</tbody></table>
        {!list.length && <div className="text-xs text-muted py-2">Nothing here.</div>}</div>
    </div>
  );
}

function SupportTab() {
  const [list, setList] = useState<{ id: string; email: string; subject: string; message: string; status: string; reply: string; createdAt: number }[]>([]);
  const [filter, setFilter] = useState("open"); const [reply, setReply] = useState<Record<string, string>>({});
  const load = () => fetch(`/api/admin/tickets${filter ? `?status=${filter}` : ""}`).then((r) => r.json()).then((j) => setList(j.tickets ?? []));
  useEffect(() => { load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);
  const send = async (id: string, status: "answered" | "closed") => { await fetch("/api/admin/tickets", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, reply: reply[id] ?? "", status }) }); setReply((r) => ({ ...r, [id]: "" })); load(); };
  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-2"><select className="select !w-auto" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="open">Open</option><option value="answered">Answered</option><option value="closed">Closed</option><option value="">All</option></select><span className="text-xs text-muted">Replies are emailed to the user (when email is configured) and shown on their Help page.</span></div>
      {list.map((t) => <div key={t.id} className="card p-3 grid gap-2 text-sm"><div className="flex flex-wrap gap-2 items-center"><span className="font-medium">{t.subject}</span><span className="badge">{t.status}</span><span className="text-xs text-muted">{t.email} · {new Date(t.createdAt).toLocaleString()}</span></div><div className="text-xs whitespace-pre-wrap text-muted">{t.message}</div>{t.reply && <div className="text-xs whitespace-pre-wrap border-l-2 border-accent pl-2">{t.reply}</div>}
        <textarea className="textarea min-h-16" placeholder="Reply…" value={reply[t.id] ?? ""} onChange={(e) => setReply((r) => ({ ...r, [t.id]: e.target.value }))} /><div className="flex gap-2"><button className="btn btn-sm" onClick={() => send(t.id, "answered")} disabled={!reply[t.id]}>Send reply</button><button className="btn btn-sm" onClick={() => send(t.id, "closed")}>Close</button></div></div>)}
      {!list.length && <div className="text-xs text-muted">No tickets.</div>}
    </div>
  );
}

// eslint-disable-next-line @next/next/no-img-element
const QrPreview = ({ src }: { src: string }) => <img src={src} alt="QR" className="h-20 rounded border border-border bg-white p-1" />;

function SiteTab() {
  const [site, setSite] = useState<SiteSettings | null>(null); const [emailOk, setEmailOk] = useState(false); const [saved, setSaved] = useState(false); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { fetch("/api/admin/site").then((r) => r.json()).then((j) => { setSite(j.site); setEmailOk(!!j.emailConfigured); }); }, []);
  if (!site) return <div className="text-sm text-muted">Loading…</div>;
  const set = (patch: Partial<SiteSettings>) => setSite({ ...site, ...patch });
  const setPay = (patch: Partial<SiteSettings["payment"]>) => setSite({ ...site, payment: { ...site.payment, ...patch } });
  const save = async () => { setErr(null); const r = await fetch("/api/admin/site", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ site }) }); const j = await r.json(); if (!r.ok) { setErr(j.error); return; } setSaved(true); setTimeout(() => setSaved(false), 1500); };
  const onQr = (f: File | null) => { if (!f) return; const rd = new FileReader(); rd.onload = () => setPay({ qrImage: String(rd.result) }); rd.readAsDataURL(f); };
  return (
    <div className="grid gap-3">
      <div className="card p-4 grid sm:grid-cols-2 gap-3 text-sm">
        <h2 className="font-medium sm:col-span-2">Support & verification</h2>
        <div><label className="label">App name</label><input className="input mt-1" value={site.appName} onChange={(e) => set({ appName: e.target.value })} /></div>
        <div><label className="label">Email verification</label><select className="select mt-1" value={site.requireEmailVerification} onChange={(e) => set({ requireEmailVerification: e.target.value as SiteSettings["requireEmailVerification"] })}><option value="auto">Auto (only when email sending is configured{emailOk ? " — configured ✓" : " — not configured"})</option><option value="always">Always</option><option value="never">Never</option></select></div>
        <div><label className="label">Support email</label><input className="input mt-1" value={site.supportEmail} onChange={(e) => set({ supportEmail: e.target.value })} placeholder="support@yourdomain.com" /></div>
        <div><label className="label">Support phone</label><input className="input mt-1" value={site.supportPhone} onChange={(e) => set({ supportPhone: e.target.value })} /></div>
        <div><label className="label">WhatsApp number</label><input className="input mt-1" value={site.whatsapp} onChange={(e) => set({ whatsapp: e.target.value })} placeholder="8801XXXXXXXXX" /></div>
      </div>
      <div className="card p-4 grid sm:grid-cols-2 gap-3 text-sm">
        <h2 className="font-medium sm:col-span-2">Payment instructions (shown on the Subscribe page)</h2>
        <div><label className="label">bKash number</label><input className="input mt-1" value={site.payment.bkash} onChange={(e) => setPay({ bkash: e.target.value })} placeholder="01XXXXXXXXX (Personal / Merchant)" /></div>
        <div><label className="label">Nagad number</label><input className="input mt-1" value={site.payment.nagad} onChange={(e) => setPay({ nagad: e.target.value })} /></div>
        <div><label className="label">Rocket number</label><input className="input mt-1" value={site.payment.rocket} onChange={(e) => setPay({ rocket: e.target.value })} /></div>
        <div><label className="label">Bank transfer details</label><input className="input mt-1" value={site.payment.bank} onChange={(e) => setPay({ bank: e.target.value })} placeholder="Bank, branch, account name & number" /></div>
        <div><label className="label">Local currency</label><input className="input mt-1" value={site.payment.currency} onChange={(e) => setPay({ currency: e.target.value })} /></div>
        <div><label className="label">USD → local conversion (price × this)</label><input className="input mt-1" type="number" value={site.payment.conversion} onChange={(e) => setPay({ conversion: Number(e.target.value) })} /></div>
        <div className="sm:col-span-2"><label className="label">Bangla QR image</label><div className="flex items-center gap-3 mt-1"><input type="file" accept="image/*" onChange={(e) => onQr(e.target.files?.[0] ?? null)} />{site.payment.qrImage && <QrPreview src={site.payment.qrImage} />}{site.payment.qrImage && <button className="btn btn-sm" onClick={() => setPay({ qrImage: "" })}>Remove</button>}</div></div>
        <div className="sm:col-span-2"><label className="label">Instructions note</label><textarea className="textarea mt-1" value={site.payment.note} onChange={(e) => setPay({ note: e.target.value })} /></div>
      </div>
      <div className="card p-4 grid gap-3 text-sm">
        <h2 className="font-medium">Help page content (Markdown)</h2>
        <div><label className="label">FAQ</label><textarea className="textarea mt-1 min-h-48 font-mono text-xs" value={site.faq} onChange={(e) => set({ faq: e.target.value })} /></div>
        <div><label className="label">Cancellation & refund policy (short, Help page)</label><textarea className="textarea mt-1 min-h-20 font-mono text-xs" value={site.cancellationPolicy} onChange={(e) => set({ cancellationPolicy: e.target.value })} /></div>
      </div>
      <div className="card p-4 grid gap-3 text-sm">
        <h2 className="font-medium">Legal pages (required by payment gateways for merchant approval)</h2>
        <div className="grid sm:grid-cols-2 gap-2"><div><label className="label">Company / legal name</label><input className="input mt-1" value={site.companyName} onChange={(e) => set({ companyName: e.target.value })} placeholder="XYZ Engineering Ltd. (trade licence holder)" /></div><div><label className="label">Registered address</label><input className="input mt-1" value={site.companyAddress} onChange={(e) => set({ companyAddress: e.target.value })} /></div></div>
        <div><label className="label">Terms of Service — /terms</label><textarea className="textarea mt-1 min-h-40 font-mono text-xs" value={site.terms} onChange={(e) => set({ terms: e.target.value })} /></div>
        <div><label className="label">Privacy Policy — /privacy</label><textarea className="textarea mt-1 min-h-40 font-mono text-xs" value={site.privacy} onChange={(e) => set({ privacy: e.target.value })} /></div>
        <div><label className="label">Refund & Cancellation Policy — /refund-policy</label><textarea className="textarea mt-1 min-h-32 font-mono text-xs" value={site.refundPolicy} onChange={(e) => set({ refundPolicy: e.target.value })} /></div>
      </div>
      {err && <div className="text-xs text-err">{err}</div>}
      <div className="flex gap-2 items-center"><button className="btn btn-primary" onClick={save}><Save size={14} /> Save settings</button>{saved && <span className="text-xs text-ok">saved</span>}</div>
    </div>
  );
}

function GatewaysTab() {
  interface GW { id: string; label: string; methods: string; docs: string; fields: { key: string; label: string; secret?: boolean; placeholder?: string }[]; enabled: boolean; sandbox: boolean; fromEnv?: boolean; values: Record<string, string> }
  const [list, setList] = useState<GW[]>([]); const [draft, setDraft] = useState<Record<string, Partial<GW>>>({}); const [msg, setMsg] = useState<string | null>(null);
  const load = () => fetch("/api/admin/gateways").then((r) => r.json()).then((j) => setList(j.gateways ?? []));
  useEffect(() => { load(); }, []);
  const save = async (g: GW) => { const d = draft[g.id] ?? {}; const r = await fetch("/api/admin/gateways", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: g.id, enabled: d.enabled ?? g.enabled, sandbox: d.sandbox ?? g.sandbox, values: d.values ?? {} }) }); const j = await r.json(); setMsg(r.ok ? `${g.label} saved` : j.error); setDraft((x) => ({ ...x, [g.id]: {} })); load(); };
  return (
    <div className="grid gap-3">
      <p className="text-xs text-muted">Online payment gateways activate plans instantly and enable automatic renewal (Stripe) — no manual approval. Credentials are encrypted. Use <b>sandbox</b> to test with the provider&apos;s test credentials, then switch to live once your merchant account is approved. Aggregators (SSLCommerz, aamarPay, shurjoPay) show bKash, Nagad, Rocket, Upay, cards and banks on their page; a direct bKash merchant API is also supported. Manual bKash/Nagad/Rocket numbers (Site settings) remain available as fallback.</p>
      {list.map((g) => { const d = draft[g.id] ?? {}; const vals = { ...g.values, ...(d.values ?? {}) }; return (
        <div key={g.id} className="card p-4 grid gap-2 text-sm">
          <div className="flex flex-wrap items-center gap-3"><span className="font-medium">{g.label}</span>{g.id === "sslcommerz" && <span className="badge text-ok border-ok/40">recommended for Bangladesh — cards + bKash + Nagad + Rocket + QR</span>}{g.fromEnv && <span className="badge">configured from environment</span>}<span className="text-xs text-muted">{g.methods}</span><a className="text-xs text-accent2" href={g.docs} target="_blank" rel="noreferrer">docs</a>
            <label className="ml-auto text-xs flex items-center gap-1"><input type="checkbox" checked={d.enabled ?? g.enabled} onChange={(e) => setDraft((x) => ({ ...x, [g.id]: { ...d, enabled: e.target.checked } }))} /> enabled</label>
            <label className="text-xs flex items-center gap-1"><input type="checkbox" checked={d.sandbox ?? g.sandbox} onChange={(e) => setDraft((x) => ({ ...x, [g.id]: { ...d, sandbox: e.target.checked } }))} /> sandbox / test mode</label></div>
          <div className="grid sm:grid-cols-2 gap-2">{g.fields.map((f) => <div key={f.key}><label className="label">{f.label}</label><input className="input mt-1" type={f.secret ? "password" : "text"} placeholder={f.placeholder} value={vals[f.key] ?? ""} onChange={(e) => setDraft((x) => ({ ...x, [g.id]: { ...d, values: { ...(d.values ?? {}), [f.key]: e.target.value } } }))} autoComplete="off" /></div>)}</div>
          <div><button className="btn btn-sm" onClick={() => save(g)}><Save size={13} /> Save</button></div>
        </div>); })}
      {msg && <div className="text-xs text-muted">{msg}</div>}
    </div>
  );
}

function TeamsTab() {
  interface T { id: string; name: string; plan: string; seats: number; expires: number | null; ownerEmail?: string; members: { email: string }[] }
  const [teams, setTeams] = useState<T[]>([]); const [plans, setPlans] = useState<Plan[]>([]); const [nt, setNt] = useState({ ownerEmail: "", name: "", plan: "team", seats: 3 }); const [err, setErr] = useState<string | null>(null);
  const load = () => { fetch("/api/admin/teams").then((r) => r.json()).then((j) => setTeams(j.teams ?? [])); fetch("/api/admin/plans").then((r) => r.json()).then((j) => setPlans(j.plans ?? [])); };
  useEffect(() => { load(); }, []);
  const create = async () => { setErr(null); const r = await fetch("/api/admin/teams", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nt) }); const j = await r.json(); if (!r.ok) { setErr(j.error); return; } load(); };
  const patch = async (id: string, body: Record<string, unknown>) => { await fetch("/api/admin/teams", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...body }) }); load(); };
  return (
    <div className="grid gap-3">
      <p className="text-xs text-muted">Teams are created automatically when someone pays for a per-seat plan; you can also create one manually (e.g. for an enterprise invoice). Owners add members on their Team page; members must have accounts.</p>
      <div className="card p-3 grid sm:grid-cols-5 gap-2 items-end text-sm">
        <div className="sm:col-span-5 label">Create team manually</div>
        <input className="input" placeholder="owner account email" value={nt.ownerEmail} onChange={(e) => setNt({ ...nt, ownerEmail: e.target.value })} />
        <input className="input" placeholder="team name" value={nt.name} onChange={(e) => setNt({ ...nt, name: e.target.value })} />
        <select className="select" value={nt.plan} onChange={(e) => setNt({ ...nt, plan: e.target.value })}>{plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <input className="input" type="number" min={1} value={nt.seats} onChange={(e) => setNt({ ...nt, seats: Number(e.target.value) })} />
        <button className="btn btn-primary" onClick={create} disabled={!nt.ownerEmail}>Create</button>
        {err && <div className="sm:col-span-5 text-xs text-err">{err}</div>}
      </div>
      {teams.map((t) => (
        <div key={t.id} className="card p-3 text-sm grid gap-2">
          <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{t.name}</span><span className="text-xs text-muted">owner {t.ownerEmail}</span><span className="badge">{t.plan}</span><span className="badge">{t.members.length} / {t.seats} seats</span>
            <input className="input !w-20 !py-0.5 ml-auto" type="number" min={1} value={t.seats} onChange={(e) => patch(t.id, { seats: Number(e.target.value) })} title="seats" />
            <input className="input !w-40 !py-0.5" type="date" value={t.expires ? new Date(t.expires).toISOString().slice(0, 10) : ""} onChange={(e) => patch(t.id, { expires: e.target.value ? new Date(e.target.value).getTime() : null })} />
            <button className="btn btn-sm text-err" onClick={() => { if (confirm("Delete this team? Members return to their own plans.")) patch(t.id, { remove: true }); }}>Delete</button></div>
          <div className="text-xs text-muted">{t.members.map((m) => m.email).join(", ")}</div>
        </div>
      ))}
    </div>
  );
}
