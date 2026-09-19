/**
 * Provider-agnostic agent loop: pick a provider (explicit or auto-fallback chain), stream a turn,
 * execute tool calls locally, feed results back, repeat until the model stops calling tools.
 */
import { TOOLS, runTool, selectToolsForText } from "@/lib/tools";
import { AUTO_CHAIN, LOCAL_FIRST_CHAIN, PROVIDER_MAP, resolveProvider, type KeyBag } from "./registry";
import { anthropicProvider } from "./providers/anthropic";
import { geminiProvider } from "./providers/gemini";
import { ungroundedNumbers } from "./grounding";
import { makeOpenAICompatProvider } from "./providers/openaiCompat";
import { buildSystemPrompt, buildCompactSystemPrompt, type Preferences } from "./prompt";
import { type AgentEvent, type ChatMessage, type ContentPart, type Provider, ProviderUnavailableError } from "./types";

const MAX_ITERATIONS = 10;

/** Turn raw provider errors (often nested JSON) into one readable line for the chat. */
export function friendlyError(raw: string, provider?: string): string {
  let msg = raw;
  for (let i = 0; i < 3; i++) {
    const m = /\{[\s\S]*\}/.exec(msg);
    if (!m) break;
    try { const j = JSON.parse(m[0]) as { error?: { message?: string } | string; message?: string }; const inner = typeof j.error === "string" ? j.error : j.error?.message ?? j.message; if (!inner || inner === msg) break; msg = inner; } catch { break; }
  }
  msg = msg.replace(/\s+/g, " ").trim();
  if (msg.length > 220) msg = msg.slice(0, 220) + "…";
  return `${provider ? `${provider}: ` : ""}${msg}`;
}

/** Rough token estimate (chars/4; images ~1,000). */
function estimateTokens(msgs: ChatMessage[]): number {
  let n = 0;
  for (const m of msgs) for (const p of m.parts) n += p.type === "text" ? p.text.length / 4 : p.type === "image" ? 1000 : p.type === "tool_call" ? JSON.stringify(p.args).length / 4 + 20 : p.content.length / 4 + 10;
  return n;
}

/**
 * Compress long conversations before sending them to the model (like other assistants do):
 *  1. drop images and shrink tool results in messages older than the last 6 turns,
 *  2. if still above the budget, drop the oldest turns and leave a short note.
 * The user's stored chat is untouched — only the request is compacted.
 */
export function compactHistory(messages: ChatMessage[], budgetTokens = 24000): ChatMessage[] {
  if (estimateTokens(messages) <= budgetTokens) return messages;
  const keepRecent = 6;
  const cut = Math.max(0, messages.length - keepRecent);
  let out: ChatMessage[] = messages.map((m, i) => i >= cut ? m : { ...m, parts: m.parts.flatMap<ContentPart>((p) => {
    if (p.type === "image") return [{ type: "text" as const, text: "[image omitted from history]" }];
    if (p.type === "tool_result") return [{ ...p, content: p.content.length > 300 ? p.content.slice(0, 300) + " …(truncated)" : p.content }];
    if (p.type === "text" && p.text.length > 2000) return [{ type: "text" as const, text: p.text.slice(0, 2000) + " …(truncated)" }];
    return [p];
  }) });
  while (estimateTokens(out) > budgetTokens && out.length > keepRecent + 1) {
    // drop the oldest turn (must keep tool_call/tool_result pairs together)
    let n = 1;
    if (out[0].role === "assistant" && out[0].parts.some((p) => p.type === "tool_call") && out[1]?.role === "tool") n = 2;
    out = out.slice(n);
  }
  // Always start with a user message; prepend a note about removed context.
  while (out.length && out[0].role !== "user") out = out.slice(1);
  return [{ role: "user", parts: [{ type: "text", text: "[Earlier parts of this conversation were summarised/removed to fit the model's context. Ask me to repeat anything if needed.]" }] }, { role: "assistant", parts: [{ type: "text", text: "Understood." }] }, ...out];
}

/** Small local models sometimes leak chain-of-thought into the answer (e.g. text ending with a stray "</think>"). Remove it. */
export function stripLeakedReasoning(text: string): string {
  let t = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const i = t.lastIndexOf("</think>");
  if (i >= 0) t = t.slice(i + 8);
  return t.replace(/^\s*<\/?think>\s*/i, "").trimStart();
}

const CALC_REQUEST = /\b(design|analy[sz]e|calculate|compute|how (many|much)|size|check|convert|estimate|quantit|bearing|moment|shear|deflect|draw|sketch|plan)\b/i;

function providerFor(id: string): Provider {
  const info = PROVIDER_MAP.get(id);
  if (!info) throw new Error(`Unknown provider ${id}`);
  if (info.kind === "anthropic") return anthropicProvider;
  if (info.kind === "gemini") return geminiProvider;
  return makeOpenAICompatProvider(id);
}

export interface AgentOptions {
  messages: ChatMessage[];
  provider: string; // provider id or "auto"
  model?: string;
  keys: KeyBag;
  preferences?: Preferences;
  signal?: AbortSignal;
  emit: (e: AgentEvent) => void;
  /** override tool set (default: all) */
  toolNames?: string[];
  /** explicit provider chain (SaaS plans); the first entry uses opts.model, others use keys[id].model */
  chain?: string[];
}

/** Try each provider in the chain until one accepts the request. Returns the chosen provider+model. */
function candidates(opts: AgentOptions): { id: string; model: string; apiKey: string; baseUrl?: string }[] {
  const ids = opts.chain ?? (opts.provider === "auto" ? AUTO_CHAIN : opts.provider === "local-first" ? LOCAL_FIRST_CHAIN : [opts.provider]);
  const out: { id: string; model: string; apiKey: string; baseUrl?: string }[] = [];
  for (const id of ids) {
    const r = resolveProvider(id, opts.keys);
    if (!r) continue;
    const isChain = opts.provider === "auto" || opts.provider === "local-first";
    const model = (opts.chain ? (id === opts.chain[0] && opts.model) : !isChain && opts.model) || opts.keys[id]?.model || r.info.models[0]?.id;
    if (!model) continue;
    out.push({ id, model, apiKey: r.apiKey, baseUrl: r.baseUrl });
  }
  return out;
}

export async function runAgent(opts: AgentOptions): Promise<void> {
  const { emit } = opts;
  const cands = candidates(opts);
  const localBudget = cands.length > 0 && cands.every((c) => c.id === "local" || c.id === "ollama") ? 8000 : 24000;
  const messages: ChatMessage[] = compactHistory([...opts.messages], localBudget);
  // Small local models (llama.cpp / Ollama) get a compact prompt and only the tools relevant to the conversation,
  // which cuts the first-turn prompt from ~8K to ~2K tokens (the dominant cost on CPU-only PCs).
  const localOnly = cands.length > 0 && cands.every((c) => c.id === "local" || c.id === "ollama");
  const convoText = messages.filter((m) => m.role === "user").map((m) => m.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join(" ")).join(" ");
  const tools = opts.toolNames ? TOOLS.filter((t) => opts.toolNames!.includes(t.name)) : selectToolsForText(convoText);
  const system = localOnly ? buildCompactSystemPrompt(opts.preferences) : buildSystemPrompt(opts.preferences);
  if (!cands.length) {
    emit({ type: "error", message: opts.provider === "auto" || opts.provider === "local-first" ? "No AI provider configured. Add at least one API key in Settings (Gemini and Groq have free tiers), or run Ollama locally." : `Provider "${opts.provider}" has no API key configured. Add it in Settings.` });
    return;
  }
  type Cand = (typeof cands)[number];
  let active: Cand | null = null;
  let provider: Provider | null = null;
  let totalUsage = { input: 0, output: 0 };
  const repeatFailures = new Map<string, number>();
  let nudged = false;
  let noToolNudged = false;
  let skippedEmpty = false;
  let groundRetried = false;
  // Where figures in the final answer may come from: the conversation as sent (user input, earlier answers, earlier
  // tool results) plus tool results produced in this run. Our own nudge messages are deliberately excluded.
  const groundSources: string[] = opts.messages.flatMap((m) => m.parts.map((p) => (p.type === "text" ? p.text : p.type === "tool_result" ? p.content : "")));
  let toolsUsed = false;
  // Constants stated in the offered tools' descriptions (e.g. "katha = 720 sq ft") are vetted, so they count as sources.
  groundSources.push(...tools.map((t) => t.description));

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    if (opts.signal?.aborted) return;
    let turn: Awaited<ReturnType<Provider["streamTurn"]>> | null = null;
    let streamedText = "";
    // Provider selection with fallback: the conversation is provider-neutral, so if the current model hits a limit
    // mid-answer (quota, request too large), the next model in the chain can carry on. Never after text has streamed.
    const tryList: Cand[] = active ? cands.slice(cands.indexOf(active)) : cands;
    const failures: string[] = [];
    candidates: for (const c of tryList) {
      const p = providerFor(c.id);
      for (let attempt = 0; ; attempt++) {
        try {
          if (c !== active && attempt === 0) emit({ type: "provider", provider: c.id, model: c.model });
          turn = await p.streamTurn({ model: c.model, apiKey: c.apiKey, baseUrl: c.baseUrl, system, messages, tools, signal: opts.signal, onText: (d) => { streamedText += d; emit({ type: "text", delta: d }); } });
          active = c; provider = p;
          break candidates;
        } catch (e) {
          // A temporary overload ("high demand") usually clears within seconds: retry the same model once before moving on.
          if (e instanceof ProviderUnavailableError && e.reason === "overloaded" && attempt === 0 && !streamedText) {
            emit({ type: "notice", message: `${PROVIDER_MAP.get(c.id)?.label ?? c.id} is busy; retrying…` });
            await new Promise((r) => setTimeout(r, 2000));
            continue;
          }
          if (e instanceof ProviderUnavailableError && !streamedText) {
            failures.push(`${c.id}: ${e.message}`);
            emit({ type: "notice", message: `${PROVIDER_MAP.get(c.id)?.label ?? c.id} unavailable (${e.reason}); trying next provider…` });
            continue candidates;
          }
          emit({ type: "error", message: `The AI service returned an error: ${friendlyError(e instanceof Error ? e.message : String(e), PROVIDER_MAP.get(c.id)?.label)}. Try again or pick another model below.` });
          return;
        }
      }
    }
    if (!turn || !active || !provider) {
      emit({ type: "error", message: `All configured providers failed:\n${failures.join("\n")}` });
      return;
    }
    if (turn.usage) {
      totalUsage = { input: totalUsage.input + turn.usage.input, output: totalUsage.output + turn.usage.output };
      emit({ type: "usage", provider: active.id, model: active.model, input: turn.usage.input, output: turn.usage.output });
    }

    const cleaned = stripLeakedReasoning(turn.text);
    if (cleaned !== turn.text) { turn.text = cleaned; emit({ type: "text_replace", text: cleaned }); }

    // A calculation-type request answered with numbers but without any tool call → the model guessed. Nudge once.
    const userText = opts.messages.filter((m) => m.role === "user").map((m) => m.parts.map((p) => (p.type === "text" ? p.text : "")).join(" ")).join(" ");
    if (iter === 0 && !turn.toolCalls.length && turn.stop === "end" && /\d/.test(turn.text) && CALC_REQUEST.test(userText) && !noToolNudged) {
      noToolNudged = true;
      emit({ type: "text_replace", text: "" });
      messages.push({ role: "user", parts: [{ type: "text", text: "Do not answer from memory. Call the appropriate tool now with the given inputs, then summarise its result." }] });
      continue;
    }

    const assistantParts: ChatMessage["parts"] = [];
    if (turn.text) assistantParts.push({ type: "text", text: turn.text });
    for (const c of turn.toolCalls) assistantParts.push({ type: "tool_call", id: c.id, name: c.name, args: c.args, ...(c.signature ? { signature: c.signature } : {}) });
    if (assistantParts.length) messages.push({ role: "assistant", parts: assistantParts });

    // Some backends (local models, gpt-oss on Groq) occasionally return a turn with no text and no tool call,
    // e.g. when all output went to hidden reasoning. Nudge once; if it stays empty, move to the next model or say so.
    if (!turn.text.trim() && !turn.toolCalls.length && (turn.stop === "end" || turn.stop === "length")) {
      if (!nudged) {
        nudged = true;
        const afterTool = messages[messages.length - 1]?.role === "tool";
        messages.push({ role: "user", parts: [{ type: "text", text: afterTool ? "Continue with the next step using the tool result above (call the next tool or give the final answer)." : "Please answer my question above. Call the appropriate tool if any calculation is needed." }] });
        continue;
      }
      const next: Cand | undefined = cands[cands.indexOf(active) + 1];
      if (next && !skippedEmpty) {
        skippedEmpty = true;
        emit({ type: "notice", message: `${PROVIDER_MAP.get(active.id)?.label ?? active.id} returned an empty reply; trying ${PROVIDER_MAP.get(next.id)?.label ?? next.id}…` });
        emit({ type: "provider", provider: next.id, model: next.model });
        active = next; provider = providerFor(next.id);
        continue;
      }
      emit({ type: "error", message: "The model returned an empty reply. Try again, or pick another model below." });
      return;
    }
    if (turn.stop === "refusal") emit({ type: "notice", message: "The model declined this request." });
    if (turn.stop === "length") emit({ type: "notice", message: "Response was cut off by the token limit." });
    if (turn.stop === "end" && !turn.toolCalls.length && turn.text.trim() && (toolsUsed || CALC_REQUEST.test(userText))) {
      const bad = ungroundedNumbers(turn.text, groundSources);
      if (bad.length && !groundRetried) {
        groundRetried = true;
        emit({ type: "notice", message: "Double-checking the figures against the calculations…" });
        emit({ type: "text_replace", text: "" });
        messages.push({ role: "user", parts: [{ type: "text", text: `Your answer contains figures that are not in the tool results or in my question: ${bad.slice(0, 12).join(", ")}. Rewrite the complete answer using only numbers from the tool results (rounding is fine). If you need another number, call a tool (for example calculate) instead of working it out yourself. Do not mention this check.` }] });
        continue;
      }
      if (bad.length) emit({ type: "notice", message: `Check these figures against the result tables above; they did not come from a calculation: ${bad.slice(0, 8).join(", ")}` });
    }
    if (turn.stop !== "tool" || !turn.toolCalls.length) break;
    toolsUsed = true;

    const resultParts: ChatMessage["parts"] = [];
    for (const call of turn.toolCalls) {
      emit({ type: "tool_call", id: call.id, name: call.name, args: call.args });
      const sig = `${call.name}:${JSON.stringify(call.args)}`;
      const output = await runTool(call.name, call.args);
      if (output.error) {
        const n = (repeatFailures.get(sig) ?? 0) + 1;
        repeatFailures.set(sig, n);
        if (n >= 3) {
          emit({ type: "tool_result", id: call.id, name: call.name, output });
          emit({ type: "error", message: `The model repeated the same failing tool call three times (${call.name}). Last error: ${output.error}. Try rephrasing, or switch to a larger model.` });
          return;
        }
        if (n === 2) output.error = `${output.error}. You already sent exactly these arguments and they failed. Change the argument NAMES to match the expected parameters listed above.`;
      }
      emit({ type: "tool_result", id: call.id, name: call.name, output });
      const content = output.error ? `ERROR: ${output.error}` : JSON.stringify({ summary: output.summary, result: output.result }, (_k, v) => (typeof v === "number" ? Number(v.toPrecision(6)) : v));
      resultParts.push({ type: "tool_result", id: call.id, name: call.name, content: content.length > 20000 ? content.slice(0, 20000) + "…(truncated)" : content, isError: !!output.error });
      if (!output.error) groundSources.push(content);
    }
    messages.push({ role: "tool", parts: resultParts });
  }
  const chosen: Cand | null = active;
  emit({ type: "done", usage: totalUsage, provider: chosen?.id ?? "", model: chosen?.model ?? "" });
}
