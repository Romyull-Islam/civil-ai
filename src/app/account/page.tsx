"use client";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { LogOut, User, ShieldCheck } from "lucide-react";
import { useEffect } from "react";
import { useSession, logoutClient } from "@/lib/client/session";

export default function AccountPage() {
  const s = useSession();
  const [pw, setPw] = useState({ current: "", next: "" }); const [pwMsg, setPwMsg] = useState<string | null>(null);
  const changePw = async () => { const r = await fetch("/api/auth/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pw) }); const j = await r.json(); setPwMsg(r.ok ? "Password changed." : j.error); if (r.ok) setPw({ current: "", next: "" }); };
  const [tfa, setTfa] = useState<{ enabled: boolean; staff: boolean } | null>(null); const [setup, setSetup] = useState<{ secret: string; otpauth: string } | null>(null); const [tcode, setTcode] = useState(""); const [tmsg, setTmsg] = useState<string | null>(null);
  useEffect(() => { fetch("/api/auth/totp").then((r) => (r.ok ? r.json() : null)).then((j) => j && setTfa(j)).catch(() => {}); }, []);
  const tfaAction = async (action: string, extra: Record<string, string> = {}) => { setTmsg(null); const r = await fetch("/api/auth/totp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...extra }) }); const j = await r.json(); if (!r.ok) { setTmsg(j.error); return; } if (action === "start") setSetup(j); else { setSetup(null); setTcode(""); setTmsg(action === "confirm" ? "Two-factor authentication enabled." : "Two-factor authentication disabled."); setTfa((t) => t && { ...t, enabled: action === "confirm" }); } };
  const outcome = useSyncExternalStore(() => () => {}, () => new URLSearchParams(window.location.search).get("payment"), () => null);
  if (!s) return <div className="p-6 text-sm text-muted">Loading…</div>;
  if (s.mode !== "saas") return <div className="p-6 text-sm text-muted">Accounts are not used in this deployment.</div>;
  if (!s.user) return <div className="p-6 text-sm">Please <Link className="text-accent2" href="/login">sign in</Link>.</div>;
  return (
    <div className="h-full overflow-y-auto"><div className="max-w-2xl mx-auto p-6 grid gap-4">
      <div className="flex items-center gap-2"><User className="text-accent" /><h1 className="text-lg font-semibold">Account</h1></div>
      {outcome && <div className={`card p-3 text-sm ${outcome === "paid" ? "border-ok/50 text-ok" : outcome === "pending" ? "border-accent/50" : "border-err/50 text-err"}`}>{outcome === "paid" ? "Payment received — your plan is active." : outcome === "pending" ? "Payment is being verified; your plan activates automatically once confirmed." : outcome === "cancelled" ? "Payment cancelled." : outcome === "failed" ? "Payment failed. Nothing was charged; you can try again or pay manually." : "We could not verify this payment. Contact support with your transaction ID."}</div>}
      <div className="card p-4 grid gap-2 text-sm">
        <div><span className="label">Signed in as</span><div>{s.user.name || s.user.email} <span className="text-muted">({s.user.email})</span> {s.user.role !== "user" && <span className="badge ml-1">{s.user.role}</span>}</div></div>
        <div><span className="label">Email</span><div>{s.user.emailVerified ? <span className="text-ok">verified ✓</span> : <><span className="text-err">not verified</span> · <Link className="text-accent2" href="/verify">enter code</Link></>}</div></div>
        <div><span className="label">Plan</span><div>{s.plan?.name} {s.user.planExpires ? <span className="text-muted">· renews/expires {new Date(s.user.planExpires).toLocaleDateString()}</span> : null} · <Link className="text-accent2" href="/pricing">see plans</Link> · <Link className="text-accent2" href="/subscribe">subscribe / renew</Link></div></div>
        <div><span className="label">AI requests today</span><div>{s.usage?.used}{s.usage?.limit !== null && s.usage?.limit !== undefined ? ` / ${s.usage.limit}` : " (unlimited)"}</div></div>
        <div><span className="label">Models available on your plan</span><ul className="mt-1 grid gap-0.5">{s.allowedModels?.map((m) => <li key={m.provider + m.model} className="text-muted">{m.provider} · {m.model}</li>)}</ul></div>
      </div>
      <div className="card p-4 grid gap-2 text-sm"><div className="font-medium">Change password</div><div className="grid sm:grid-cols-2 gap-2"><input className="input" type="password" placeholder="current password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" /><input className="input" type="password" placeholder="new password (8+)" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" /></div>{pwMsg && <div className="text-xs">{pwMsg}</div>}<button className="btn btn-sm justify-self-start" onClick={changePw} disabled={!pw.current || pw.next.length < 8}>Update password</button></div>
      {tfa && (
        <div className="card p-4 grid gap-2 text-sm">
          <div className="flex items-center gap-2 font-medium"><ShieldCheck size={16} className="text-accent" /> Two-factor authentication (authenticator app){tfa.enabled && <span className="badge text-ok border-ok/40">enabled</span>}{tfa.staff && !tfa.enabled && <span className="badge text-err border-err/40">recommended for staff</span>}</div>
          {!tfa.enabled && !setup && <button className="btn btn-sm justify-self-start" onClick={() => tfaAction("start")}>Set up 2FA</button>}
          {setup && (
            <div className="grid gap-2">
              <div className="text-xs text-muted">Add this to Google Authenticator / Authy / Microsoft Authenticator by entering the key manually, then type the 6-digit code to confirm.</div>
              <div className="font-mono text-base break-all">{setup.secret}</div>
              <div className="text-xs text-muted break-all">{setup.otpauth}</div>
              <div className="flex gap-2"><input className="input !w-40 text-center tracking-widest" inputMode="numeric" maxLength={6} placeholder="000000" value={tcode} onChange={(e) => setTcode(e.target.value)} /><button className="btn btn-primary btn-sm" onClick={() => tfaAction("confirm", { code: tcode })} disabled={tcode.length !== 6}>Confirm</button><button className="btn btn-sm" onClick={() => setSetup(null)}>Cancel</button></div>
            </div>
          )}
          {tfa.enabled && <div className="flex gap-2 items-center"><input className="input !w-56" type="password" placeholder="password to disable" value={tcode} onChange={(e) => setTcode(e.target.value)} /><button className="btn btn-sm text-err" onClick={() => tfaAction("disable", { password: tcode })} disabled={!tcode}>Disable 2FA</button></div>}
          {tmsg && <div className="text-xs">{tmsg}</div>}
        </div>
      )}
      <button className="btn justify-self-start" onClick={logoutClient}><LogOut size={15} /> Sign out</button>
    </div></div>
  );
}
