"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { Download, Copy, Check } from "lucide-react";
import { Logo } from "@/components/Logo";
import { Markdown } from "@/components/Markdown";
import { ToolCard } from "@/components/ToolCard";
import { PromoBanner } from "@/components/PromoBanner";
import type { Conversation, UIMessage } from "@/lib/db";
import { conversationToMarkdown, downloadMarkdown } from "@/lib/client/chat-export";

interface Shared { title: string; createdAt: number; expiresAt: number; payload: { title: string; messages: UIMessage[] } }

/** Public, read-only view of a shared conversation (no sign-in needed). */
export default function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<Shared | null>(null); const [err, setErr] = useState<string | null>(null); const [copied, setCopied] = useState(false);
  useEffect(() => { fetch(`/api/share?id=${encodeURIComponent(id)}`).then(async (r) => { const j = await r.json(); if (!r.ok) setErr(j.error); else setData(j); }).catch(() => setErr("Could not load this link.")); }, [id]);
  const conv: Conversation | null = data ? { id, title: data.payload.title, createdAt: data.createdAt, updatedAt: data.createdAt, messages: data.payload.messages } : null;
  return (
    <div className="h-full overflow-y-auto">
      <meta name="robots" content="noindex" />
      <div className="max-w-3xl mx-auto p-4 md:p-6 grid gap-4">
        <div className="flex items-center gap-2"><Logo size={24} /><span className="text-xs text-muted">shared conversation</span>
          <Link href="/signup" className="btn btn-primary btn-sm ml-auto">Try CivilMate free</Link></div>
        <PromoBanner placement="share" />
        {err && <div className="card p-4 text-sm">{err}</div>}
        {conv && data && (
          <>
            <div className="flex flex-wrap items-center gap-2"><h1 className="text-lg font-semibold flex-1">{conv.title}</h1>
              <button className="btn btn-sm" onClick={() => downloadMarkdown(conv)}><Download size={14} /> Download</button>
              <button className="btn btn-sm" onClick={async () => { await navigator.clipboard.writeText(conversationToMarkdown(conv)); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>{copied ? <Check size={14} className="text-ok" /> : <Copy size={14} />} Copy text</button></div>
            <div className="text-xs text-muted">Shared {new Date(data.createdAt).toLocaleDateString()} · link valid until {new Date(data.expiresAt).toLocaleDateString()} · results are preliminary and must be checked by a licensed engineer.</div>
            {conv.messages.map((m, i) => {
              const isUser = m.role === "user";
              return (
                <div key={i} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                  <div className={isUser ? "bg-elev2 rounded-2xl rounded-br-sm px-4 py-2.5 max-w-[85%]" : "w-full"}>
                    {m.parts.map((p, j) => p.type === "text" ? (isUser ? <div key={j} className="whitespace-pre-wrap text-sm">{p.text}</div> : <Markdown key={j} text={p.text} />) : p.type === "tool_call" ? <ToolCard key={j} name={p.name} args={p.args} output={m.toolOutputs?.[p.id]} /> : null)}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
