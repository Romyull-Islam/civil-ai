"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { CloudDownload, Trash2, MessageSquare, PencilRuler, Cloud } from "lucide-react";
import { useSession, accountsMode } from "@/lib/client/session";
import { db, type Conversation } from "@/lib/db";
import { toDxf } from "@/lib/drawing/dxf";
import type { Drawing } from "@/lib/drawing/types";

interface Item { id: string; kind: "chat" | "drawing"; title: string; size: number; updatedAt: number }
interface Quota { limitBytes: number; maxItems: number; used: { bytes: number; count: number } }
const mb = (b: number) => (b / 1048576).toFixed(2);
const now = () => Date.now();

export default function SavesPage() {
  const s = useSession();
  const [items, setItems] = useState<Item[]>([]); const [quota, setQuota] = useState<Quota | null>(null); const [msg, setMsg] = useState<string | null>(null);
  const load = () => fetch("/api/saves").then((r) => r.json()).then((j) => { setItems(j.items ?? []); setQuota(j.quota ?? null); });
  useEffect(() => { load(); }, []);
  const restoreChat = async (id: string) => { const j = await (await fetch(`/api/saves?id=${id}`)).json(); const conv = j.payload as Conversation; await db.conversations.put({ ...conv, updatedAt: now() }); setMsg(`Restored "${conv.title}" to this device. Open it from the Assistant.`); };
  const downloadDrawing = async (id: string, fmt: "dxf" | "json") => { const j = await (await fetch(`/api/saves?id=${id}`)).json(); const d = j.payload as Drawing; const blob = new Blob([fmt === "dxf" ? toDxf(d) : JSON.stringify(d, null, 1)], { type: fmt === "dxf" ? "application/dxf" : "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${d.title.replace(/[^a-z0-9]+/gi, "-")}.${fmt}`; a.click(); };
  const remove = async (id: string) => { if (!confirm("Delete this saved item from your account?")) return; await fetch("/api/saves", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }); load(); };
  if (s && !accountsMode(s)) return <div className="p-6 text-sm text-muted">Cloud backups are part of the online service.</div>;
  return (
    <div className="h-full overflow-y-auto"><div className="max-w-3xl mx-auto p-6 grid gap-4">
      <div className="flex items-center gap-2"><Cloud className="text-accent" /><h1 className="text-lg font-semibold">My cloud backups</h1></div>
      {quota && (quota.limitBytes > 0 ? (
        <div className="card p-4 text-sm grid gap-2">
          <div className="flex justify-between"><span>{mb(quota.used.bytes)} MB of {mb(quota.limitBytes)} MB used</span><span className="text-muted">{quota.used.count} / {quota.maxItems} items</span></div>
          <div className="w-full h-2 bg-elev2 rounded overflow-hidden"><div className="h-full bg-accent" style={{ width: `${Math.min(100, (100 * quota.used.bytes) / quota.limitBytes)}%` }} /></div>
          <p className="text-xs text-muted">Back up a chat from the Assistant sidebar (cloud icon) or a drawing from the drawing toolbar (Save to account). Chats are stored as text only (images excluded) and compressed; drawings as editable geometry. Restore on any device.</p>
        </div>
      ) : <div className="card p-4 text-sm">Cloud backup of chats and designs is included in paid plans. Your chats still live on this device and can be exported from the Assistant sidebar. <Link className="text-accent2" href="/pricing">See plans</Link>.</div>)}
      {msg && <div className="text-xs text-ok">{msg}</div>}
      <div className="grid gap-2">
        {items.map((it) => (
          <div key={it.id} className="card p-3 text-sm flex flex-wrap items-center gap-3">
            {it.kind === "chat" ? <MessageSquare size={16} className="text-accent2" /> : <PencilRuler size={16} className="text-accent" />}
            <div className="flex-1 min-w-40"><div className="font-medium truncate">{it.title}</div><div className="text-xs text-muted">{it.kind} · {(it.size / 1024).toFixed(0)} KB · {new Date(it.updatedAt).toLocaleString()}</div></div>
            {it.kind === "chat" ? <button className="btn btn-sm" onClick={() => restoreChat(it.id)}><CloudDownload size={13} /> Restore to this device</button> : <><button className="btn btn-sm" onClick={() => downloadDrawing(it.id, "dxf")}><CloudDownload size={13} /> DXF</button><button className="btn btn-sm" onClick={() => downloadDrawing(it.id, "json")}>JSON</button></>}
            <button className="btn btn-sm text-err" onClick={() => remove(it.id)}><Trash2 size={13} /></button>
          </div>
        ))}
        {!items.length && quota && quota.limitBytes > 0 && <div className="text-xs text-muted">Nothing saved yet.</div>}
      </div>
    </div></div>
  );
}
