"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { nanoid } from "nanoid";
import { Send, Square, Trash2, ImagePlus, X, CloudUpload, Share2 } from "lucide-react";
import { ShareDialog } from "./ShareDialog";
import { PromoBanner } from "./PromoBanner";
import { LogoMark } from "./Logo";
import { db, type Conversation, type UIMessage } from "@/lib/db";
import { useSettings } from "@/lib/client/settings";
import { streamChat } from "@/lib/client/stream";
import type { ChatMessage, ContentPart } from "@/lib/ai/types";
import { Markdown } from "./Markdown";
import { ToolCard } from "./ToolCard";
import { PROVIDERS } from "@/lib/ai/registry";
import { LocalAI } from "./LocalAI";
import { ModelPicker } from "./ModelPicker";
import { useSession, refreshSession } from "@/lib/client/session";

const SUGGESTIONS = [
  "Design a 10\"×18\" (250×450 mm) RC beam, 16 ft span, 1.2 kip/ft factored load, 3000 psi concrete and Grade 60 steel per BNBC 2020, then draw the section.",
  "Plan a 2-storey house on a 5 katha plot in Dhaka (3 bedrooms, garage, dining) with RAJUK setbacks; show coverage and FAR, then draw the floor plans.",
  "How many bags of cement, cft of sand and cft of stone chips for 100 cft of 1:2:4 (M20) concrete?",
  "Estimate bricks, cement and sand for a 10-inch brick wall 30 ft long and 10 ft high with 12 mm plaster both sides.",
  "What are the seismic zone coefficient and basic wind speed for Chittagong per BNBC 2020? Cite the clauses.",
  "Size an isolated footing for a 15\"×15\" column carrying 120 kip service load; allowable bearing 2 ksf; 3000 psi concrete.",
  "Design a simply supported RC beam, 6 m span, 300×500 mm, 25 kN/m factored UDL, M25/Fe500 per IS 456, then draw the section.",
  "Analyze a 4 m cantilever with a 15 kN point load at the tip and 5 kN/m UDL and check an ISMB 300 section.",
  "What is the minimum cover and minimum steel for a one-way slab? Compare BNBC 2020, IS 456 and ACI 318 with clause numbers.",
  "Draw a floor plan: living 4.5×5.5 m, kitchen 3×3.5 m, bedroom 3.6×4.2 m, bath 2×2.4 m.",
];

function toWire(msgs: UIMessage[]): ChatMessage[] {
  return msgs.map(({ role, parts }) => ({ role, parts }));
}

const now = () => Date.now();
const uid = () => nanoid();

function titleFrom(text: string) { return text.replace(/\s+/g, " ").trim().slice(0, 60) || "New conversation"; }

export function Chat() {
  const settings = useSettings();
  const session = useSession();
  const [conv, setConv] = useState<Conversation | null>(null);
  const [input, setInput] = useState("");
  const [images, setImages] = useState<{ mimeType: string; data: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>("");
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refreshList = useCallback(() => { window.dispatchEvent(new Event("civil-ai:conversations")); }, []);
  useEffect(() => {
    const days = settings.autoDeleteDays;
    const cleanup = days > 0 ? db.conversations.where("updatedAt").below(now() - days * 86400000).delete() : Promise.resolve(0);
    cleanup.catch(() => 0).then((n) => { if (n) window.dispatchEvent(new Event("civil-ai:conversations")); });
  }, [settings.autoDeleteDays]);
  // A chat deleted from the sidebar (or "delete all" in Settings) closes here too.
  useEffect(() => {
    const check = () => { const id = conv?.id; if (id) db.conversations.get(id).then((row) => { if (!row) setConv(null); }); };
    window.addEventListener("civil-ai:conversations", check);
    return () => window.removeEventListener("civil-ai:conversations", check);
  }, [conv?.id]);
  const [backupMsg, setBackupMsg] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const backup = async (c: Conversation, silent = false) => {
    const r = await fetch("/api/saves", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: c.id, kind: "chat", title: c.title, payload: c }) });
    const j = await r.json();
    if (!silent) { setBackupMsg(r.ok ? "Backed up to your account." : j.error); setTimeout(() => setBackupMsg(null), 4000); }
    if (r.ok) refreshSession().catch(() => {});
  };
  useEffect(() => { if (conv) bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [conv, conv?.messages.length, status]);

  const persist = useCallback(async (c: Conversation) => { await db.conversations.put(c); refreshList(); }, [refreshList]);
  const params = useSearchParams(); const router = useRouter();
  useEffect(() => {
    const c = params.get("c"); const fresh = params.get("new");
    if (fresh) queueMicrotask(() => { setConv(null); setInput(""); setImages([]); router.replace("/"); });
    else if (c) { const wantShare = params.get("share") === "1"; db.conversations.get(c).then((row) => { if (row) { setConv(row); if (wantShare) setShareOpen(true); db.conversations.update(c, { updatedAt: now() }).catch(() => {}); } router.replace("/"); }); }
  }, [params, router]);

  const deleteConversation = async (id: string) => { await db.conversations.delete(id); if (conv?.id === id) setConv(null); refreshList(); };

  const addImages = async (files: FileList | null) => {
    if (!files) return;
    const arr: typeof images = [];
    for (const f of Array.from(files).slice(0, 4)) {
      if (!f.type.startsWith("image/")) continue;
      const data = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res((r.result as string).split(",")[1]); r.readAsDataURL(f); });
      arr.push({ mimeType: f.type, data, name: f.name });
    }
    setImages((prev) => [...prev, ...arr].slice(0, 4));
  };

  const send = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content && !images.length) return;
    if (!settings || busy) return;
    const parts: ContentPart[] = [...images.map((im) => ({ type: "image" as const, mimeType: im.mimeType, data: im.data })), { type: "text" as const, text: content || "Describe this image." }];
    const userMsg: UIMessage = { id: uid(), role: "user", parts, createdAt: now() };
    const base: Conversation = conv ?? { id: uid(), title: titleFrom(content), createdAt: now(), updatedAt: now(), messages: [] };
    const assistant: UIMessage = { id: uid(), role: "assistant", parts: [], createdAt: now(), toolOutputs: {}, meta: { notices: [] } };
    let current: Conversation = { ...base, updatedAt: now(), messages: [...base.messages, userMsg, assistant] };
    setConv(current); setInput(""); setImages([]); setBusy(true); setStatus("Connecting…");
    const ctrl = new AbortController(); abortRef.current = ctrl;
    const history = toWire(current.messages.slice(0, -1));
    // pending tool calls are appended as parts on the assistant message; tool results go to a following "tool" message (wire only)
    let textBuf = "";
    const update = (fn: (a: UIMessage) => UIMessage) => {
      const msgs = current.messages.slice();
      msgs[msgs.length - 1] = fn(msgs[msgs.length - 1]);
      current = { ...current, messages: msgs, updatedAt: now() };
      setConv(current);
    };
    try {
      for await (const ev of streamChat(history, settings, ctrl.signal)) {
        if (ev.type === "provider") { setStatus(`${PROVIDERS.find((p) => p.id === ev.provider)?.label ?? ev.provider} · ${ev.model}`); update((a) => ({ ...a, meta: { ...a.meta, provider: ev.provider, model: ev.model } })); }
        else if (ev.type === "text") { textBuf += ev.delta; update((a) => { const parts = a.parts.slice(); const last = parts[parts.length - 1]; if (last?.type === "text") parts[parts.length - 1] = { type: "text", text: last.text + ev.delta }; else parts.push({ type: "text", text: ev.delta }); return { ...a, parts }; }); }
        else if (ev.type === "text_replace") { textBuf = ev.text; update((a) => { const parts = a.parts.slice(); let i = parts.length; while (i > 0 && parts[i - 1].type === "text") i--; const kept = parts.slice(0, i); if (ev.text) kept.push({ type: "text", text: ev.text }); return { ...a, parts: kept }; }); }
        else if (ev.type === "tool_call") { textBuf = ""; update((a) => ({ ...a, parts: [...a.parts, { type: "tool_call", id: ev.id, name: ev.name, args: ev.args }] })); }
        else if (ev.type === "tool_result") { update((a) => ({ ...a, toolOutputs: { ...a.toolOutputs, [ev.id]: ev.output } })); }
        else if (ev.type === "notice") { update((a) => ({ ...a, meta: { ...a.meta, notices: [...(a.meta?.notices ?? []), ev.message] } })); }
        else if (ev.type === "error") { update((a) => ({ ...a, meta: { ...a.meta, error: ev.message } })); }
        else if (ev.type === "done") { update((a) => ({ ...a, meta: { ...a.meta, usage: ev.usage, provider: ev.provider, model: ev.model } })); }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") update((a) => ({ ...a, meta: { ...a.meta, error: (e as Error).message } }));
    } finally {
      setBusy(false); setStatus(""); abortRef.current = null;
      if (session?.mode === "saas") refreshSession().catch(() => {});
      void textBuf;
      await persist(current);
      if (session?.mode === "saas" && settings.autoBackup && (session.cloudQuota?.limitBytes ?? 0) > 0) backup(current, true).catch(() => {});
    }
  };

  const stop = () => abortRef.current?.abort();

  return (
    <div className="flex h-full min-h-0">
      <section className="flex-1 min-w-0 flex flex-col relative">
        {conv && (
          <div className="flex items-center gap-2 px-4 py-2 border-b border-border">
            <div className="font-medium text-sm truncate flex-1" title={conv.title}>{conv.title}</div>
            {backupMsg && <span className="text-xs text-ok">{backupMsg}</span>}
            {session?.mode === "saas" && (session.cloudQuota?.limitBytes ?? 0) > 0 && <button className="btn btn-sm" onClick={() => backup(conv)} title="Back up this chat to my account"><CloudUpload size={14} /> <span className="hidden sm:inline">Back up</span></button>}
            <button className="btn btn-sm" onClick={() => setShareOpen(true)} title="Share or download this chat"><Share2 size={14} /> <span className="hidden sm:inline">Share</span></button>
            <button className="btn btn-sm" onClick={() => { if (confirm("Delete this conversation?")) deleteConversation(conv.id); }} title="Delete this chat"><Trash2 size={14} /></button>
          </div>
        )}
        {shareOpen && conv && <ShareDialog conv={conv} onClose={() => setShareOpen(false)} />}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto px-4 py-6 grid gap-4">
            {!conv && (
              <div className="grid gap-4 mt-6">
                <div className="text-center">
                  <LogoMark size={44} className="inline-block" />
                  <h1 className="text-xl font-semibold mt-2">What are we building today?</h1>
                  <p className="text-xs text-muted mt-1">Common Bangladeshi jobs first (BNBC 2020, RAJUK, psi / katha / cft), then international examples.</p>
                  <p className="text-sm text-muted mt-1">Ask for designs, analysis, drawings, quantities, code clauses or site advice. Calculations run in verified engineering tools, not in the language model.</p>
                  {session?.mode === "byok" && <p className="text-xs text-muted mt-2">No key yet? Open Settings and add a free Gemini or Groq key, or run Ollama locally.</p>}
                  {session?.mode === "desktop" && <p className="text-xs text-muted mt-2">Works offline with the built-in model. Link your CivilMate account in Settings for stronger cloud models.</p>}
                </div>
                {session?.mode !== "saas" && <LocalAI compact />}
                <div className="grid sm:grid-cols-2 gap-2">
                  {SUGGESTIONS.map((s) => <button key={s} className="card text-left p-3 text-sm hover:border-accent2 transition" onClick={() => send(s)}>{s}</button>)}
                </div>
              </div>
            )}
            {conv?.messages.map((m) => <MessageView key={m.id} m={m} />)}
            {busy && status && <div className="text-xs text-muted flex items-center gap-2"><span className="typing"><span /><span /><span /></span>{status}</div>}
            <div ref={bottomRef} />
          </div>
        </div>
        <div className="border-t border-border bg-bg/80 backdrop-blur">
          <div className="max-w-4xl mx-auto px-4 pt-3 pb-5 grid gap-2">
            {session?.mode === "saas" && !busy && <PromoBanner placement="chat" />}
            {images.length > 0 && (
              <div className="flex gap-2 flex-wrap">
                {images.map((im, i) => (
                  <div key={i} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`data:${im.mimeType};base64,${im.data}`} alt={im.name} className="h-16 w-16 object-cover rounded-lg border border-border" />
                    <button className="absolute -top-1 -right-1 bg-elev border border-border rounded-full p-0.5" onClick={() => setImages(images.filter((_, j) => j !== i))} aria-label="Remove image"><X size={12} /></button>
                  </div>
                ))}
              </div>
            )}
            <div className="rounded-2xl border border-border bg-elev shadow-lg shadow-black/20 focus-within:border-accent2 transition">
              <textarea
                className="w-full bg-transparent border-0 outline-none resize-none px-4 pt-4 pb-2 text-base leading-6 min-h-[64px] max-h-[240px] placeholder:text-muted"
                placeholder="Ask anything, e.g. design a 230×450 beam for 80 kN·m, draw a 400×400 column with 8T16, plan a 2-storey house on a 10×12 m plot…"
                value={input}
                rows={2}
                onChange={(e) => { setInput(e.target.value); e.target.style.height = "auto"; e.target.style.height = Math.min(240, e.target.scrollHeight) + "px"; }}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                onPaste={(e) => { if (e.clipboardData.files.length) addImages(e.clipboardData.files); }}
              />
              <div className="flex items-center gap-2 px-2 pb-2">
                <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => addImages(e.target.files)} />
                <button className="btn btn-sm" onClick={() => fileRef.current?.click()} title="Attach a site photo or drawing image"><ImagePlus size={16} /> <span className="hidden sm:inline">Image</span></button>
                <div className="flex-1 min-w-0 flex items-center gap-3"><ModelPicker /><span className="text-[11px] text-muted hidden md:inline">Code: {settings?.preferences.designCode}</span></div>
                {busy ? <button className="btn" onClick={stop} title="Stop"><Square size={16} /> Stop</button> : <button className="btn btn-primary rounded-xl px-4 py-2" onClick={() => send()} disabled={!input.trim() && !images.length} title="Send (Enter)"><Send size={16} /> <span className="hidden sm:inline">Send</span></button>}
              </div>
            </div>
            <div className="text-[11px] text-muted text-center">Enter to send · Shift+Enter for a new line · results are preliminary and must be checked by a licensed engineer</div>
          </div>
        </div>
      </section>
    </div>
  );
}

function MessageView({ m }: { m: UIMessage }) {
  if (m.role === "tool") return null;
  const isUser = m.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`${isUser ? "bg-elev2 rounded-2xl rounded-br-sm px-4 py-2.5 max-w-[85%]" : "w-full"}`}>
        {m.parts.map((p, i) => {
          if (p.type === "text") return isUser ? <div key={i} className="whitespace-pre-wrap text-sm">{p.text}</div> : <Markdown key={i} text={p.text} />;
          // eslint-disable-next-line @next/next/no-img-element
          if (p.type === "image") return <img key={i} src={`data:${p.mimeType};base64,${p.data}`} alt="attachment" className="max-h-56 rounded-lg border border-border mb-2" />;
          if (p.type === "tool_call") return <ToolCard key={i} name={p.name} args={p.args} output={m.toolOutputs?.[p.id]} pending={!m.toolOutputs?.[p.id]} />;
          return null;
        })}
        {!isUser && m.meta?.notices?.map((n, i) => <div key={i} className="text-xs text-muted mt-1">ℹ {n}</div>)}
        {!isUser && m.meta?.error && <div className="text-sm text-err mt-1 whitespace-pre-wrap">⚠ {m.meta.error}</div>}
        {!isUser && m.meta?.model && <div className="text-[11px] text-muted mt-2">{m.meta.provider} · {m.meta.model}{m.meta.usage ? ` · ${m.meta.usage.input + m.meta.usage.output} tokens` : ""}</div>}
      </div>
    </div>
  );
}
