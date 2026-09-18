/** Live model listing so Settings can show current model ids for a provider. */
import { PROVIDERS, resolveProvider, type KeyBag } from "@/lib/ai/registry";

export const runtime = "nodejs";

export async function GET() {
  return Response.json(PROVIDERS.map((p) => ({ ...p, configured: !!resolveProvider(p.id, {}) })));
}

export async function POST(req: Request) {
  const { provider, keys } = (await req.json()) as { provider: string; keys?: KeyBag };
  const r = resolveProvider(provider, keys ?? {});
  if (!r) return Response.json({ error: "Provider not configured" }, { status: 400 });
  try {
    if (r.info.kind === "gemini") {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(r.apiKey)}&pageSize=200`);
      const j = (await res.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[]; error?: { message: string } };
      if (j.error) return Response.json({ error: j.error.message }, { status: 400 });
      return Response.json({ models: (j.models ?? []).filter((m) => m.supportedGenerationMethods?.includes("generateContent")).map((m) => m.name.replace(/^models\//, "")) });
    }
    if (r.info.kind === "anthropic") {
      const res = await fetch("https://api.anthropic.com/v1/models?limit=100", { headers: { "x-api-key": r.apiKey, "anthropic-version": "2023-06-01" } });
      const j = (await res.json()) as { data?: { id: string }[]; error?: { message: string } };
      if (j.error) return Response.json({ error: j.error.message }, { status: 400 });
      return Response.json({ models: (j.data ?? []).map((m) => m.id) });
    }
    const res = await fetch(`${r.baseUrl}/models`, { headers: r.apiKey && r.apiKey !== "ollama" ? { Authorization: `Bearer ${r.apiKey}` } : {} });
    if (!res.ok) return Response.json({ error: `${res.status} ${res.statusText}` }, { status: 400 });
    const j = (await res.json()) as { data?: { id: string }[]; models?: { name: string }[] };
    return Response.json({ models: (j.data ?? []).map((m) => m.id).concat((j.models ?? []).map((m) => m.name)) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
