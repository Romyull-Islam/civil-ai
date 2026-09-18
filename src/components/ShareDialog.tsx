"use client";
import { useState } from "react";
import { X, Link2, Copy, Check, Download, FileJson, Share2, Mail, MessageCircle, Trash2 } from "lucide-react";
import type { Conversation } from "@/lib/db";
import { conversationToMarkdown, downloadMarkdown, downloadJson } from "@/lib/client/chat-export";
import { useSession } from "@/lib/client/session";

/** Download / copy / share a conversation. Share links exist only in the online (SaaS) version. */
export function ShareDialog({ conv, onClose }: { conv: Conversation; onClose: () => void }) {
  const session = useSession();
  const online = session?.mode === "saas" && !!session.user;
  const [link, setLink] = useState<{ id: string; url: string; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [copied, setCopied] = useState<string | null>(null);
  const copy = async (what: string, text: string) => { try { await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(null), 2000); } catch { setErr("Copy failed. Select and copy manually."); } };
  const create = async () => {
    setBusy(true); setErr(null);
    const r = await fetch("/api/share", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversation: conv }) });
    const j = await r.json(); setBusy(false);
    if (!r.ok) { setErr(j.error); return; }
    setLink({ id: j.id, url: `${window.location.origin}/share/${j.id}`, expiresAt: j.expiresAt });
  };
  const stop = async () => { if (!link) return; await fetch("/api/share", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: link.id }) }); setLink(null); };
  const nativeShare = async () => {
    try {
      if (link) await navigator.share({ title: conv.title, text: `${conv.title} (CivilMate)`, url: link.url });
      else { const file = new File([conversationToMarkdown(conv)], `${conv.title.slice(0, 40)}.md`, { type: "text/markdown" }); await navigator.share({ title: conv.title, files: [file] }); }
    } catch { /* cancelled or unsupported */ }
  };
  const canNative = typeof navigator !== "undefined" && "share" in navigator;
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onMouseDown={onClose}>
      <div className="card w-full max-w-md p-5 grid gap-4" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2"><Share2 size={18} className="text-accent" /><h2 className="font-semibold flex-1 truncate">Share or download</h2><button onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <div className="text-sm text-muted truncate">{conv.title}</div>

        <div className="grid gap-2">
          <div className="label">Download</div>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-sm" onClick={() => downloadMarkdown(conv)}><Download size={14} /> Readable (.md)</button>
            <button className="btn btn-sm" onClick={() => downloadJson(conv)} title="Can be imported back in Settings → Data controls"><FileJson size={14} /> Backup (.json)</button>
            <button className="btn btn-sm" onClick={() => copy("text", conversationToMarkdown(conv))}>{copied === "text" ? <Check size={14} className="text-ok" /> : <Copy size={14} />} Copy as text</button>
          </div>
        </div>

        <div className="grid gap-2">
          <div className="label">Share link</div>
          {!online ? <p className="text-xs text-muted">Share links are available in the online version when signed in. You can still download or copy the chat.</p> : !link ? (
            <>
              <p className="text-xs text-muted">Creates a read-only page anyone with the link can open. Includes questions, answers, results and drawings; images are left out. Expires after 30 days; you can stop sharing any time.</p>
              <button className="btn btn-primary justify-self-start" onClick={create} disabled={busy}><Link2 size={15} /> {busy ? "Creating…" : "Create share link"}</button>
            </>
          ) : (
            <>
              <div className="flex gap-1"><input className="input font-mono text-xs" readOnly value={link.url} onFocus={(e) => e.target.select()} /><button className="btn" onClick={() => copy("link", link.url)}>{copied === "link" ? <Check size={15} className="text-ok" /> : <Copy size={15} />}</button></div>
              <div className="flex flex-wrap gap-2">
                <a className="btn btn-sm" href={`https://wa.me/?text=${encodeURIComponent(`${conv.title}: ${link.url}`)}`} target="_blank" rel="noreferrer"><MessageCircle size={14} /> WhatsApp</a>
                <a className="btn btn-sm" href={`mailto:?subject=${encodeURIComponent(conv.title)}&body=${encodeURIComponent(`Here is the CivilMate conversation:\n${link.url}`)}`}><Mail size={14} /> Email</a>
                {canNative && <button className="btn btn-sm" onClick={nativeShare}><Share2 size={14} /> More…</button>}
                <button className="btn btn-sm text-err" onClick={stop}><Trash2 size={14} /> Stop sharing</button>
              </div>
              <div className="text-[11px] text-muted">Link works until {new Date(link.expiresAt).toLocaleDateString()}. Later changes to this chat are not included; create a new link to share them.</div>
            </>
          )}
          {!online && canNative && <button className="btn btn-sm justify-self-start" onClick={nativeShare}><Share2 size={14} /> Share file…</button>}
          {err && <div className="text-xs text-err">{err}</div>}
        </div>
      </div>
    </div>
  );
}
