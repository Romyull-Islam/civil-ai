/**
 * Provider-agnostic agent loop: pick a provider (explicit or auto-fallback chain), stream a turn,
 * execute tool calls locally, feed results back, repeat until the model stops calling tools.
 */
import { TOOLS, runTool, selectToolsForText } from "@/lib/tools";
import { AUTO_CHAIN, LOCAL_FIRST_CHAIN, PROVIDER_MAP, resolveProvider, type KeyBag } from "./registry";
import { anthropicProvider } from "./providers/anthropic";
import { geminiProvider } from "./providers/gemini";
import { makeOpenAICompatProvider } from "./providers/openaiCompat";
import { buildSystemPrompt, buildCompactSystemPrompt, type Preferences } from "./prompt";
import { type AgentEvent, type ChatMessage, type Provider, ProviderUnavailableError } from "./types";

const MAX_ITERATIONS = 10;

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
  const messages: ChatMessage[] = [...opts.messages];
  const cands = candidates(opts);
  // Small local models (llama.cpp / Ollama) get a compact prompt and only the tools relevant to the conversation,
  // which cuts the first-turn prompt from ~8K to ~2K tokens (the dominant cost on CPU-only PCs).
  const localOnly = cands.length > 0 && cands.every((c) => c.id === "local" || c.id === "ollama");
  const convoText = messages.filter((m) => m.role === "user").map((m) => m.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join(" ")).join(" ");
  const tools = opts.toolNames ? TOOLS.filter((t) => opts.toolNames!.includes(t.name)) : localOnly ? selectToolsForText(convoText) : TOOLS;
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

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    if (opts.signal?.aborted) return;
    let turn: Awaited<ReturnType<Provider["streamTurn"]>> | null = null;
    let streamedText = "";
    // Provider selection with fallback (only before any text has streamed for this turn).
    const tryList: Cand[] = active ? [active] : cands;
    const failures: string[] = [];
    for (const c of tryList) {
      const p = providerFor(c.id);
      try {
        if (!active) emit({ type: "provider", provider: c.id, model: c.model });
        turn = await p.streamTurn({ model: c.model, apiKey: c.apiKey, baseUrl: c.baseUrl, system, messages, tools, signal: opts.signal, onText: (d) => { streamedText += d; emit({ type: "text", delta: d }); } });
        active = c; provider = p;
        break;
      } catch (e) {
        if (e instanceof ProviderUnavailableError && !streamedText && !active) {
          failures.push(`${c.id}: ${e.message}`);
          emit({ type: "notice", message: `${PROVIDER_MAP.get(c.id)?.label ?? c.id} unavailable (${e.reason}); trying next provider…` });
          continue;
        }
        emit({ type: "error", message: e instanceof Error ? e.message : String(e) });
        return;
      }
    }
    if (!turn || !active || !provider) {
      emit({ type: "error", message: `All configured providers failed:\n${failures.join("\n")}` });
      return;
    }
    if (turn.usage) totalUsage = { input: totalUsage.input + turn.usage.input, output: totalUsage.output + turn.usage.output };

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
    for (const c of turn.toolCalls) assistantParts.push({ type: "tool_call", id: c.id, name: c.name, args: c.args });
    if (assistantParts.length) messages.push({ role: "assistant", parts: assistantParts });

    // Some local/OpenAI-compatible backends return an empty turn right after tool results; nudge once to continue.
    if (!turn.text.trim() && !turn.toolCalls.length && turn.stop === "end" && messages[messages.length - 1]?.role === "tool" && !nudged) {
      nudged = true;
      messages.push({ role: "user", parts: [{ type: "text", text: "Continue with the next step using the tool result above (call the next tool or give the final answer)." }] });
      continue;
    }
    if (turn.stop === "refusal") emit({ type: "notice", message: "The model declined this request." });
    if (turn.stop === "length") emit({ type: "notice", message: "Response was cut off by the token limit." });
    if (turn.stop !== "tool" || !turn.toolCalls.length) break;

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
        if (n === 2) output.error = `${output.error} — You already sent exactly these arguments and they failed. Change the argument NAMES to match the expected parameters listed above.`;
      }
      emit({ type: "tool_result", id: call.id, name: call.name, output });
      const content = output.error ? `ERROR: ${output.error}` : JSON.stringify({ summary: output.summary, result: output.result }, (_k, v) => (typeof v === "number" ? Number(v.toPrecision(6)) : v));
      resultParts.push({ type: "tool_result", id: call.id, name: call.name, content: content.length > 20000 ? content.slice(0, 20000) + "…(truncated)" : content, isError: !!output.error });
    }
    messages.push({ role: "tool", parts: resultParts });
  }
  const chosen: Cand | null = active;
  emit({ type: "done", usage: totalUsage, provider: chosen?.id ?? "", model: chosen?.model ?? "" });
}
