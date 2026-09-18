"use client";
import { useEffect, useState } from "react";
import { LifeBuoy, Send } from "lucide-react";
import { Markdown } from "@/components/Markdown";
import { useSession } from "@/lib/client/session";

export default function HelpPage() {
  const s = useSession();
  const [site, setSite] = useState<{ faq: string; cancellationPolicy: string; supportEmail: string; supportPhone: string; whatsapp: string; appName: string } | null>(null);
  const [email, setEmail] = useState(""); const [subject, setSubject] = useState(""); const [message, setMessage] = useState(""); const [sent, setSent] = useState(false); const [err, setErr] = useState<string | null>(null);
  const [mine, setMine] = useState<{ id: string; subject: string; status: string; reply: string; createdAt: number }[]>([]);
  useEffect(() => { fetch("/api/site").then((r) => r.json()).then((j) => setSite(j.site)); fetch("/api/tickets").then((r) => r.json()).then((j) => setMine(j.tickets ?? [])).catch(() => {}); }, []);
  const submit = async () => { setErr(null); const r = await fetch("/api/tickets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: s?.user?.email ?? email, subject, message }) }); const j = await r.json(); if (!r.ok) { setErr(j.error); return; } setSent(true); setMine((m) => [j.ticket, ...m]); };
  return (
    <div className="h-full overflow-y-auto"><div className="max-w-3xl mx-auto p-6 grid gap-5">
      <div className="flex items-center gap-2"><LifeBuoy className="text-accent" /><h1 className="text-lg font-semibold">Help & support</h1></div>
      {site && <div className="card p-4"><Markdown text={site.faq} /></div>}
      {site && <div className="card p-4"><h2 className="font-medium mb-1">Cancellations & refunds</h2><Markdown text={site.cancellationPolicy} /></div>}
      <div className="card p-4 grid gap-2 text-sm">
        <h2 className="font-medium">Contact support</h2>
        {site && (site.supportEmail || site.supportPhone || site.whatsapp) && <div className="text-xs text-muted">{site.supportEmail && <span>Email: {site.supportEmail} · </span>}{site.supportPhone && <span>Phone: {site.supportPhone} · </span>}{site.whatsapp && <a className="text-accent2" href={`https://wa.me/${site.whatsapp.replace(/\D/g, "")}`} target="_blank" rel="noreferrer">WhatsApp</a>}</div>}
        {!s?.user && <input className="input" placeholder="your email" value={email} onChange={(e) => setEmail(e.target.value)} />}
        <input className="input" placeholder="Subject (e.g. cancellation, refund, bug, question)" value={subject} onChange={(e) => setSubject(e.target.value)} />
        <textarea className="textarea min-h-28" placeholder="Describe the issue. For payments include the transaction ID." value={message} onChange={(e) => setMessage(e.target.value)} />
        {err && <div className="text-err text-xs">{err}</div>}
        {sent ? <div className="text-ok text-xs">Ticket submitted. We reply by email.</div> : <button className="btn btn-primary justify-self-start" onClick={submit} disabled={!subject || !message || (!s?.user && !email)}><Send size={14} /> Send</button>}
      </div>
      {mine.length > 0 && <div className="card p-4 text-sm"><div className="label mb-2">Your tickets</div>{mine.map((t) => <div key={t.id} className="border-t border-border py-2"><div className="flex gap-2 items-center"><span className="font-medium">{t.subject}</span><span className="badge">{t.status}</span><span className="text-xs text-muted ml-auto">{new Date(t.createdAt).toLocaleDateString()}</span></div>{t.reply && <div className="text-xs mt-1 text-muted whitespace-pre-wrap">Reply: {t.reply}</div>}</div>)}</div>}
    </div></div>
  );
}
