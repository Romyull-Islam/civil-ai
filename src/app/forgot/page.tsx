"use client";
import { useState } from "react";
import Link from "next/link";
import { KeyRound } from "lucide-react";
export default function ForgotPage() {
  const [email, setEmail] = useState(""); const [sent, setSent] = useState(false);
  const submit = async (e: React.FormEvent) => { e.preventDefault(); await fetch("/api/auth/forgot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) }); setSent(true); };
  return (
    <div className="min-h-full flex items-center justify-center p-6"><form onSubmit={submit} className="card p-6 w-full max-w-sm grid gap-3">
      <div className="flex items-center gap-2"><KeyRound className="text-accent" /><h1 className="font-medium">Reset your password</h1></div>
      {sent ? <p className="text-sm">If that email has an account, a 6-digit code was sent. <Link className="text-accent2" href={`/reset?email=${encodeURIComponent(email)}`}>Enter the code</Link>.</p> : <>
        <input className="input" type="email" placeholder="your email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <button className="btn btn-primary justify-center">Send reset code</button></>}
      <Link className="text-xs text-muted text-center" href="/login">Back to sign in</Link>
    </form></div>
  );
}
