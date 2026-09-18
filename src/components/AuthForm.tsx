"use client";
import { useState } from "react";
import Link from "next/link";
import { Logo } from "./Logo";
import { refreshSession } from "@/lib/client/session";

export function AuthForm({ kind }: { kind: "login" | "signup" }) {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [totp, setTotp] = useState(""); const [needsTotp, setNeedsTotp] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    const r = await fetch(`/api/auth/${kind}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, name, totp: totp || undefined }) });
    const j = await r.json();
    setBusy(false);
    if (r.status === 202 && j.needsTotp) { setNeedsTotp(true); return; }
    if (!r.ok) { setErr(j.error ?? "Failed"); return; }
    const info = await refreshSession();
    if (info.user && !info.user.emailVerified) { window.location.assign(new URL("/verify", window.location.origin).toString()); return; }
    const next = new URLSearchParams(window.location.search).get("next");
    window.location.href = next && next.startsWith("/") ? next : "/";
  };
  return (
    <div className="min-h-full flex items-center justify-center p-6">
      <form onSubmit={submit} className="card p-6 w-full max-w-sm grid gap-3">
        <div className="flex items-center gap-2 mb-1"><Logo size={30} /></div>
        <h1 className="font-medium">{kind === "login" ? "Sign in" : "Create your account"}</h1>
        {kind === "signup" && <div><label className="label">Name</label><input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></div>}
        <div><label className="label">Email</label><input className="input mt-1" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></div>
        <div><label className="label">Password</label><input className="input mt-1" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={kind === "login" ? "current-password" : "new-password"} /></div>
        {needsTotp && <div><label className="label">Authenticator code</label><input className="input mt-1 text-center tracking-widest" inputMode="numeric" maxLength={6} value={totp} onChange={(e) => setTotp(e.target.value)} autoFocus /></div>}
        {err && <div className="text-sm text-err">{err}</div>}
        <button className="btn btn-primary justify-center" disabled={busy}>{busy ? "…" : kind === "login" ? "Sign in" : "Sign up"}</button>
        <div className="text-xs text-muted text-center">{kind === "login" ? <>No account? <Link className="text-accent2" href="/signup">Sign up</Link> · <Link className="text-accent2" href="/forgot">Forgot password?</Link></> : <>Have an account? <Link className="text-accent2" href="/login">Sign in</Link></>} · <Link className="text-accent2" href="/pricing">Plans</Link></div>
        <div className="text-[11px] text-muted text-center">By continuing you agree to the <Link className="text-accent2" href="/terms">Terms</Link>, <Link className="text-accent2" href="/privacy">Privacy</Link> and <Link className="text-accent2" href="/refund-policy">Refund</Link> policies.</div>
      </form>
    </div>
  );
}
