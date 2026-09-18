"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { Send, Square, Plus, Trash2, ImagePlus, X, Sparkles } from "lucide-react";
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
  "Design a simply supported RC beam, 6 m span, 300×500 mm, carrying 25 kN/m factored UDL, M25/Fe500 per IS 456, then draw the section.",
  "How many cement bags, sand and aggregate for 12 m³ of M20 concrete?",
  "Analyze a 4 m cantilever with a 15 kN point load at the tip and 5 kN/m UDL. Steel section ISMB 300.",
  "Size an isolated footing for a 400×400 column carrying 900 kN service load; SBC 180 kN/m².",
  "What is the minimum cover and minimum steel for a slab per IS 456? Cite clauses.",
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
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [conv, setConv] = useState<Conversation | null>(null);
  const [input, setInput] = useState("");
  const [images, setImages] = useState<{ mimeType: string; data: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>("");
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refreshList = useCallback(() => { db.conversations.orderBy("updatedAt").reverse().limit(100).toArray().then((rows) => setConvs(rows)); }, []);
  useEffect(() => {
    let alive = true;
    db.conversations.orderBy("updatedAt").reverse().limit(100).toArray().then((rows) => { if (alive) setConvs(rows); });
    return () => { alive = false; };
  }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [conv?.messages.length, status]);

  const persist = useCallback(async (c: Conversation) => { await db.conversations.put(c); refreshList(); }, [refreshList]);

  const newConversation = () => { setConv(null); setInput(""); setImages([]); };
  const openConversation = async (id: string) => { const c = await db.conversations.get(id); if (c) setConv(c); };
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
    }
  };

  const stop = () => abortRef.current?.abort();

  return (
    <div className="flex h-full min-h-0">
      <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r border-border">
        <div className="p-2"><button className="btn w-full justify-center" onClick={newConversation}><Plus size={16} /> New chat</button></div>
        <div className="flex-1 overflow-y-auto px-2 pb-2 grid content-start gap-1">
          {convs.map((c) => (
            <div key={c.id} className={`group flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm cursor-pointer ${conv?.id === c.id ? "bg-elev2" : "hover:bg-elev2"}`} onClick={() => openConversation(c.id)}>
              <span className="truncate flex-1">{c.title}</span>
              <button className="opacity-0 group-hover:opacity-100 text-muted hover:text-err" onClick={(e) => { e.stopPropagation(); deleteConversation(c.id); }} aria-label="Delete"><Trash2 size={14} /></button>
            </div>
          ))}
          {!convs.length && <div className="text-xs text-muted px-2 py-4">Conversations are stored locally in your browser (IndexedDB).</div>}
        </div>
      </aside>
      <section className="flex-1 min-w-0 flex flex-col">
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-4 py-6 grid gap-4">
            {!conv && (
              <div className="grid gap-4 mt-6">
                <div className="text-center">
                  <Sparkles className="inline text-accent" size={28} />
                  <h1 className="text-xl font-semibold mt-2">What are we building today?</h1>
                  <p className="text-sm text-muted mt-1">Ask for designs, analysis, drawings, quantities, code clauses or site advice. Calculations run in verified engineering tools, not in the language model.</p>
                  {session?.mode === "byok" && <p className="text-xs text-muted mt-2">No key yet? Open Settings and add a free Gemini or Groq key, or run Ollama locally.</p>}
                  {session?.mode === "desktop" && <p className="text-xs text-muted mt-2">Works offline with the built-in model. Link your Civil AI account in Settings for stronger cloud models.</p>}
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
        <div className="border-t border-border bg-elev">
          <div className="max-w-3xl mx-auto p-3 grid gap-2">
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
            <div className="flex items-end gap-2">
              <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => addImages(e.target.files)} />
              <button className="btn" onClick={() => fileRef.current?.click()} title="Attach site photo / drawing image"><ImagePlus size={16} /></button>
              <textarea
                className="textarea min-h-11 max-h-48 resize-y"
                placeholder="Ask anything — e.g. “design a 230×450 beam for 80 kN·m”, “draw a 400×400 column with 8T16”… (Enter to send, Shift+Enter for newline)"
                value={input}
                rows={1}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                onPaste={(e) => { if (e.clipboardData.files.length) addImages(e.clipboardData.files); }}
              />
              {busy ? <button className="btn" onClick={stop} title="Stop"><Square size={16} /></button> : <button className="btn btn-primary" onClick={() => send()} disabled={!input.trim() && !images.length}><Send size={16} /></button>}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <ModelPicker />
              <span className="text-[11px] text-muted">Code: {settings?.preferences.designCode}</span>
            </div>
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
