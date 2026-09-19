"use client";
import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { KeyRound } from "lucide-react";
import { PasswordInput } from "@/components/PasswordInput";
export default function ResetPage() {
  const initial = useSyncExternalStore(() => () => {}, () => new URLSearchParams(window.location.search).get("email") ?? "", () => "");
  const [email, setEmail] = useState(initial); const [code, setCode] = useState(""); const [pw, setPw] = useState(""); const [err, setErr] = useState<string | null>(null); const [done, setDone] = useState(false);
  const submit = async (e: React.FormEvent) => { e.preventDefault(); setErr(null); const r = await fetch("/api/auth/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, code, password: pw }) }); const j = await r.json(); if (!r.ok) { setErr(j.error); return; } setDone(true); };
  return (
    <div className="min-h-full flex items-center justify-center p-6"><form onSubmit={submit} className="card p-6 w-full max-w-sm grid gap-3">
      <div className="flex items-center gap-2"><KeyRound className="text-accent" /><h1 className="font-medium">Set a new password</h1></div>
      {done ? <p className="text-sm text-ok">Password changed. <Link className="text-accent2" href="/login">Sign in</Link>.</p> : <>
        <input className="input" type="email" placeholder="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="input text-center tracking-widest" inputMode="numeric" maxLength={6} placeholder="6-digit code" required value={code} onChange={(e) => setCode(e.target.value)} />
        <PasswordInput placeholder="new password (8+ characters)" required minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
        {err && <div className="text-sm text-err">{err}</div>}
        <button className="btn btn-primary justify-center">Change password</button></>}
    </form></div>
  );
}
