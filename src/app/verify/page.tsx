"use client";
import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { useSession, refreshSession } from "@/lib/client/session";

const noop = () => () => {};
/** Email from ?email= (after sign-up or a refused sign-in), read without a Suspense boundary. */
const useQueryEmail = () => useSyncExternalStore(noop, () => new URLSearchParams(window.location.search).get("email") ?? "", () => "");

export default function VerifyPage() {
  const s = useSession();
  const queryEmail = useQueryEmail();
  const [typed, setTyped] = useState<string | null>(null);
  const email = typed ?? (queryEmail || s?.user?.email || "");
  const [code, setCode] = useState(""); const [msg, setMsg] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const verify = async () => {
    setErr(null); setBusy(true);
    const r = await fetch("/api/auth/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, code }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(j.error ?? "Invalid or expired code"); return; }
    await refreshSession();
    window.location.assign(new URL("/", window.location.origin).toString());
  };
  const resend = async () => { setErr(null); setMsg(null); const r = await fetch("/api/auth/resend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) }); const j = await r.json().catch(() => ({})); if (r.ok) setMsg(j.message ?? "A new code was sent."); else setErr(j.error); };
  if (s?.user?.emailVerified) return <div className="p-6 text-sm">Your email is verified. <Link className="text-accent2" href="/">Go to CivilMate</Link>.</div>;
  return (
    <div className="min-h-full flex items-center justify-center p-6"><div className="card p-6 w-full max-w-sm grid gap-3">
      <div className="flex items-center gap-2"><MailCheck className="text-accent" /><h1 className="font-medium">Verify your email</h1></div>
      <p className="text-sm text-muted">Enter the 6-digit code we emailed you to activate your account and sign in. It can take a minute to arrive; check your spam folder too.</p>
      <div><label className="label">Email</label><input className="input mt-1" type="email" autoComplete="email" value={email} onChange={(e) => setTyped(e.target.value)} /></div>
      <input className="input text-center text-lg tracking-widest" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="000000" aria-label="Verification code" />
      {err && <div className="text-sm text-err">{err}</div>}{msg && <div className="text-sm text-ok">{msg}</div>}
      <button className="btn btn-primary justify-center" onClick={verify} disabled={code.length !== 6 || !email || busy}>{busy ? "…" : "Verify and sign in"}</button>
      <button className="text-xs text-muted hover:text-fg" onClick={resend} disabled={!email}>Send a new code</button>
      <div className="text-xs text-muted text-center">Wrong address? <Link className="underline" href="/signup">Sign up again</Link> · <Link className="underline" href="/login">Sign in</Link></div>
    </div></div>
  );
}
