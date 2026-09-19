import { runAgent } from "@/lib/ai/agent";
import type { ChatMessage, AgentEvent } from "@/lib/ai/types";
import type { KeyBag } from "@/lib/ai/registry";
import { appMode } from "@/lib/saas/mode";
import { getSessionUser, quota, limitMessage, getServerKeys, chooseModel, recordUsage } from "@/lib/saas/service";
import { getCloudLink, cloudChat } from "@/lib/saas/cloud";

export const runtime = "nodejs";
export const maxDuration = 300;

interface Body { messages: ChatMessage[]; provider?: string; model?: string; keys?: KeyBag; preferences?: Record<string, string> }

export async function POST(req: Request) {
  let body: Body;
  try { body = (await req.json()) as Body; } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!Array.isArray(body.messages) || !body.messages.length) return Response.json({ error: "messages required" }, { status: 400 });

  let provider = body.provider ?? "auto";
  let model = body.model;
  let keys: KeyBag = body.keys ?? {};
  let onUsage: ((e: Extract<AgentEvent, { type: "usage" }>) => void) | null = null;
  let chainOverride: string[] | undefined;

  // Downloadable/self-hosted app linked to a hosted CivilMate account: cloud models are answered by the backend (its keys, its quotas);
  // local/ollama requests and users with their own keys still run here.
  if (appMode() !== "saas" && provider !== "local" && provider !== "ollama" && provider !== "local-first") {
    const link = await getCloudLink();
    // desktop build: users never hold keys → always forward cloud models; byok: a user's own key wins.
    const ownKey = appMode() === "byok" && provider !== "auto" && !!keys[provider]?.apiKey;
    if (link && !ownKey) {
      if (appMode() === "desktop") keys = {};
      const upstream = await cloudChat(link, { messages: body.messages, provider: provider === "auto" ? undefined : provider, model, preferences: body.preferences }, req.signal);
      if (!upstream.ok) { let msg = `${upstream.status} ${upstream.statusText}`; try { msg = ((await upstream.json()) as { error?: string }).error ?? msg; } catch { /* ignore */ } return Response.json({ error: `Cloud account: ${msg}` }, { status: upstream.status }); }
      return new Response(upstream.body, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
    }
  }

  if (appMode() === "saas") {
    const user = await getSessionUser(req);
    if (!user) return Response.json({ error: "Please sign in to use the assistant." }, { status: 401 });
    if (!user.emailVerified) return Response.json({ error: "Please verify your email address first (check your inbox for the code)." }, { status: 403 });
    const q = await quota(user);
    if (q.remaining <= 0) return Response.json({ error: limitMessage(q) }, { status: 429 });
    const choice = chooseModel(q.plan, body.provider, body.model);
    provider = choice.provider; model = choice.model;
    // Server-held keys only; the client's keys are ignored. Per-provider preferred models come from the plan.
    keys = await getServerKeys();
    for (const c of choice.chain) keys[c.provider] = { ...(keys[c.provider] ?? {}), model: keys[c.provider]?.model ?? c.model };
    chainOverride = [...new Set(choice.chain.map((c) => c.provider))];
    let counted = false;
    onUsage = (e) => { recordUsage(user.id, e.provider, e.model, e.input, e.output, !counted).catch(() => {}); counted = true; };
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (e: AgentEvent) => {
        if (e.type === "usage" && onUsage) onUsage(e);
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`)); } catch { /* closed */ }
      };
      runAgent({ messages: body.messages, provider, model, keys, preferences: body.preferences, signal: req.signal, emit, chain: chainOverride })
        .catch((e) => emit({ type: "error", message: e instanceof Error ? e.message : String(e) }))
        .finally(() => { try { controller.close(); } catch { /* already closed */ } });
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
}
