"use client";
import { useState } from "react";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { useSession, refreshSession } from "@/lib/client/session";

export default function VerifyPage() {
  const s = useSession();
  const [code, setCode] = useState(""); const [msg, setMsg] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null);
  const verify = async () => { setErr(null); const r = await fetch("/api/auth/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) }); const j = await r.json(); if (!r.ok) { setErr(j.error); return; } await refreshSession(); window.location.assign(new URL("/", window.location.origin).toString()); };
  const resend = async () => { setErr(null); const r = await fetch("/api/auth/resend", { method: "POST" }); const j = await r.json(); setMsg(r.ok ? "A new code was sent." : j.error); };
  if (s?.user?.emailVerified) return <div className="p-6 text-sm">Your email is verified. <Link className="text-accent2" href="/">Go to the assistant</Link>.</div>;
  return (
    <div className="min-h-full flex items-center justify-center p-6"><div className="card p-6 w-full max-w-sm grid gap-3">
      <div className="flex items-center gap-2"><MailCheck className="text-accent" /><h1 className="font-medium">Verify your email</h1></div>
      <p className="text-sm text-muted">We sent a 6-digit code to <b>{s?.user?.email}</b>. Enter it below. Calculators and drawings work without verification; the AI assistant needs a verified email.</p>
      <input className="input text-center text-lg tracking-widest" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} placeholder="000000" />
      {err && <div className="text-sm text-err">{err}</div>}{msg && <div className="text-sm text-ok">{msg}</div>}
      <button className="btn btn-primary justify-center" onClick={verify} disabled={code.length !== 6}>Verify</button>
      <button className="text-xs text-muted hover:text-fg" onClick={resend}>Resend code</button>
    </div></div>
  );
}
