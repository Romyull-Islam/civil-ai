import { runAgent } from "@/lib/ai/agent";
import type { ChatMessage, AgentEvent } from "@/lib/ai/types";
import type { KeyBag } from "@/lib/ai/registry";
import { appMode, hasAccounts, isCompany } from "@/lib/saas/mode";
import { licenseState } from "@/lib/company/license";
import { getSessionUser, quota, limitMessage, getServerKeys, chooseModel, recordUsage } from "@/lib/saas/service";
import { getCloudLink, cloudChat } from "@/lib/saas/cloud";
import { checkTopic } from "@/lib/ai/topic";
import { getSite } from "@/lib/saas/site";

export const runtime = "nodejs";
export const maxDuration = 300;

interface Body { messages: ChatMessage[]; provider?: string; model?: string; keys?: KeyBag; preferences?: Record<string, string> }

const SSE_HEADERS = { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" };

/** Topic guard switch: CIVIL_AI_TOPIC_GUARD=on/off locks it (company installs); otherwise the admin setting (hosted) or off (own keys / desktop). */
async function topicGuardEnabled(): Promise<boolean> {
  const env = process.env.CIVIL_AI_TOPIC_GUARD?.toLowerCase();
  if (env === "on" || env === "1" || env === "true") return true;
  if (env === "off" || env === "0" || env === "false") return false;
  if (appMode() === "byok" || appMode() === "desktop") return false;
  try { return (await getSite()).topicGuard !== "off"; } catch { return true; }
}

/** A local answer streamed like a model answer, without calling any model (costs nothing). */
function localReply(text: string) {
  const events: AgentEvent[] = [{ type: "provider", provider: "civilmate", model: "local" }, { type: "text", delta: text }, { type: "done", provider: "civilmate", model: "local" }];
  return new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""), { headers: SSE_HEADERS });
}

export async function POST(req: Request) {
  let body: Body;
  try { body = (await req.json()) as Body; } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!Array.isArray(body.messages) || !body.messages.length) return Response.json({ error: "messages required" }, { status: 400 });

  // Off-topic questions, greetings and "what can you do" are answered here, before any model call or credit check.
  const topic = checkTopic(body.messages, await topicGuardEnabled());
  if (topic.action === "reply") return localReply(topic.text);

  let provider = body.provider ?? "auto";
  let model = body.model;
  let keys: KeyBag = body.keys ?? {};
  let onUsage: ((e: Extract<AgentEvent, { type: "usage" }>) => void) | null = null;
  let chainOverride: string[] | undefined;

  // Downloadable/self-hosted app linked to a hosted CivilMate account: cloud models are answered by the backend (its keys, its quotas);
  // local/ollama requests and users with their own keys still run here.
  if ((appMode() === "byok" || appMode() === "desktop") && provider !== "local" && provider !== "ollama" && provider !== "local-first") {
    const link = await getCloudLink();
    // desktop build: users never hold keys → always forward cloud models; byok: a user's own key wins.
    const ownKey = appMode() === "byok" && provider !== "auto" && !!keys[provider]?.apiKey;
    if (link && !ownKey) {
      if (appMode() === "desktop") keys = {};
      const upstream = await cloudChat(link, { messages: body.messages, provider: provider === "auto" ? undefined : provider, model, preferences: body.preferences }, req.signal);
      if (!upstream.ok) { let msg = `${upstream.status} ${upstream.statusText}`; try { msg = ((await upstream.json()) as { error?: string }).error ?? msg; } catch { /* ignore */ } return Response.json({ error: `Cloud account: ${msg}` }, { status: upstream.status }); }
      return new Response(upstream.body, { headers: SSE_HEADERS });
    }
  }

  if (hasAccounts()) {
    const user = await getSessionUser(req);
    if (!user) return Response.json({ error: "Please sign in to use the assistant." }, { status: 401 });
    if (!user.emailVerified) return Response.json({ error: "Please verify your email address first (check your inbox for the code)." }, { status: 403 });
    if (isCompany()) { const lic = await licenseState(); if (!lic.chatAllowed) return Response.json({ error: lic.message }, { status: 403 }); }
    const q = await quota(user);
    if (q.remaining <= 0) return Response.json({ error: limitMessage(q) }, { status: 429 });
    let choice: ReturnType<typeof chooseModel>;
    try { choice = chooseModel(q.plan, body.provider, body.model); } catch (e) { return Response.json({ error: (e as Error).message }, { status: 503 }); }
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
  return new Response(stream, { headers: SSE_HEADERS });
}
