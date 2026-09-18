"use client";
import { useEffect, useState } from "react";
import { Shield, KeyRound, Users, BarChart3, Layers, Save, RefreshCw, Wallet, LifeBuoy, Globe } from "lucide-react";
import type { SiteSettings } from "@/lib/saas/site";
import { PROVIDERS } from "@/lib/ai/registry";
import { useSession } from "@/lib/client/session";
import type { Plan } from "@/lib/saas/plans";

type Tab = "users" | "keys" | "plans" | "usage" | "payments" | "support" | "site" | "gateways";
type Role = "superadmin" | "admin" | "support" | "user";
interface AdminUser { id: string; email: string; name: string; role: Role; plan: string; planExpires: number | null; createdAt: number; disabled: number }
const TAB_ROLES: Record<Tab, Role[]> = { gateways: ["superadmin", "admin"], users: ["superadmin", "admin", "support"], payments: ["superadmin", "admin", "support"], support: ["superadmin", "admin", "support"], keys: ["superadmin", "admin"], plans: ["superadmin", "admin"], site: ["superadmin", "admin"], usage: ["superadmin", "admin"] };

export default function AdminPage() {
  const s = useSession();
  const [tab, setTab] = useState<Tab>("users");
  if (!s) return <div className="p-6 text-sm text-muted">Loading…</div>;
  const role = s.user?.role ?? "user";
  if (s.mode !== "saas" || role === "user") return <div className="p-6 text-sm text-err">Staff access only.</div>;
  const tabs = ([["users", Users, "Users & subscriptions"], ["payments", Wallet, "Payments"], ["support", LifeBuoy, "Support tickets"], ["keys", KeyRound, "Provider API keys"], ["gateways", Wallet, "Payment gateways"], ["plans", Layers, "Plans"], ["site", Globe, "Site & payment settings"], ["usage", BarChart3, "Usage"]] as const).filter(([id]) => TAB_ROLES[id].includes(role));
  return (
    <div className="h-full overflow-y-auto"><div className="max-w-6xl mx-auto p-4 grid gap-4">
      <div className="flex items-center gap-2"><Shield className="text-accent" /><h1 className="text-lg font-semibold">{role === "support" ? "Helpdesk" : "Admin"}</h1><span className="badge">{role}</span></div>
      <div className="flex gap-2 flex-wrap">{tabs.map(([id, Icon, label]) => <button key={id} className={`btn btn-sm ${tab === id ? "btn-primary" : ""}`} onClick={() => setTab(id)}><Icon size={14} /> {label}</button>)}</div>
      {tab === "users" && <UsersTab me={s.user!} />}{tab === "payments" && <PaymentsTab />}{tab === "support" && <SupportTab />}{tab === "keys" && <KeysTab />}{tab === "gateways" && <GatewaysTab />}{tab === "plans" && <PlansTab />}{tab === "site" && <SiteTab />}{tab === "usage" && <UsageTab />}
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
  const [text, setText] = useState(""); const [err, setErr] = useState<string | null>(null); const [ok, setOk] = useState(false);
  const load = () => fetch("/api/admin/plans").then((r) => r.json()).then((j) => setText(JSON.stringify(j.plans, null, 2)));
  useEffect(() => { load(); }, []);
  const save = async () => { setErr(null); try { const plans = JSON.parse(text); const r = await fetch("/api/admin/plans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plans }) }); const j = await r.json(); if (!r.ok) throw new Error(j.error); setOk(true); setTimeout(() => setOk(false), 1500); } catch (e) { setErr((e as Error).message); } };
  const reset = async () => { const j = await fetch("/api/admin/plans").then((r) => r.json()); setText(JSON.stringify(j.defaults, null, 2)); };
  return (
    <div className="card p-4 grid gap-2">
      <p className="text-xs text-muted">Each plan lists the providers and model ids its subscribers may use (the first entry is the default), the daily request limit and the marketing features. Users pick among their allowed models from the chat selector.</p>
      <textarea className="textarea font-mono text-xs min-h-96" value={text} onChange={(e) => setText(e.target.value)} />
      {err && <div className="text-xs text-err">{err}</div>}
      <div className="flex gap-2"><button className="btn btn-primary" onClick={save}><Save size={14} /> Save plans</button><button className="btn" onClick={reset}>Load defaults</button>{ok && <span className="text-xs text-ok self-center">saved</span>}</div>
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
        <div><label className="label">Cancellation & refund policy</label><textarea className="textarea mt-1 min-h-20 font-mono text-xs" value={site.cancellationPolicy} onChange={(e) => set({ cancellationPolicy: e.target.value })} /></div>
      </div>
      {err && <div className="text-xs text-err">{err}</div>}
      <div className="flex gap-2 items-center"><button className="btn btn-primary" onClick={save}><Save size={14} /> Save settings</button>{saved && <span className="text-xs text-ok">saved</span>}</div>
    </div>
  );
}

function GatewaysTab() {
  interface GW { id: string; label: string; methods: string; docs: string; fields: { key: string; label: string; secret?: boolean; placeholder?: string }[]; enabled: boolean; sandbox: boolean; values: Record<string, string> }
  const [list, setList] = useState<GW[]>([]); const [draft, setDraft] = useState<Record<string, Partial<GW>>>({}); const [msg, setMsg] = useState<string | null>(null);
  const load = () => fetch("/api/admin/gateways").then((r) => r.json()).then((j) => setList(j.gateways ?? []));
  useEffect(() => { load(); }, []);
  const save = async (g: GW) => { const d = draft[g.id] ?? {}; const r = await fetch("/api/admin/gateways", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: g.id, enabled: d.enabled ?? g.enabled, sandbox: d.sandbox ?? g.sandbox, values: d.values ?? {} }) }); const j = await r.json(); setMsg(r.ok ? `${g.label} saved` : j.error); setDraft((x) => ({ ...x, [g.id]: {} })); load(); };
  return (
    <div className="grid gap-3">
      <p className="text-xs text-muted">Online payment gateways activate plans instantly and enable automatic renewal (Stripe) — no manual approval. Credentials are encrypted. Use <b>sandbox</b> to test with the provider&apos;s test credentials, then switch to live once your merchant account is approved. Aggregators (SSLCommerz, aamarPay, shurjoPay) show bKash, Nagad, Rocket, Upay, cards and banks on their page; a direct bKash merchant API is also supported. Manual bKash/Nagad/Rocket numbers (Site settings) remain available as fallback.</p>
      {list.map((g) => { const d = draft[g.id] ?? {}; const vals = { ...g.values, ...(d.values ?? {}) }; return (
        <div key={g.id} className="card p-4 grid gap-2 text-sm">
          <div className="flex flex-wrap items-center gap-3"><span className="font-medium">{g.label}</span><span className="text-xs text-muted">{g.methods}</span><a className="text-xs text-accent2" href={g.docs} target="_blank" rel="noreferrer">docs</a>
            <label className="ml-auto text-xs flex items-center gap-1"><input type="checkbox" checked={d.enabled ?? g.enabled} onChange={(e) => setDraft((x) => ({ ...x, [g.id]: { ...d, enabled: e.target.checked } }))} /> enabled</label>
            <label className="text-xs flex items-center gap-1"><input type="checkbox" checked={d.sandbox ?? g.sandbox} onChange={(e) => setDraft((x) => ({ ...x, [g.id]: { ...d, sandbox: e.target.checked } }))} /> sandbox / test mode</label></div>
          <div className="grid sm:grid-cols-2 gap-2">{g.fields.map((f) => <div key={f.key}><label className="label">{f.label}</label><input className="input mt-1" type={f.secret ? "password" : "text"} placeholder={f.placeholder} value={vals[f.key] ?? ""} onChange={(e) => setDraft((x) => ({ ...x, [g.id]: { ...d, values: { ...(d.values ?? {}), [f.key]: e.target.value } } }))} autoComplete="off" /></div>)}</div>
          <div><button className="btn btn-sm" onClick={() => save(g)}><Save size={13} /> Save</button></div>
        </div>); })}
      {msg && <div className="text-xs text-muted">{msg}</div>}
    </div>
  );
}
