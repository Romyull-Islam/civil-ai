import { guardArea } from "@/lib/saas/admin";
import { gatewayStatus, getGatewayConfig, setGatewayConfig, gatewayById } from "@/lib/saas/gateways";
import { audit } from "@/lib/saas/security";
export const runtime = "nodejs";
export const GET = guardArea("keys", async () => Response.json({ gateways: await gatewayStatus() }));
export const POST = guardArea("keys", async (req, actor) => {
  const { id, enabled, sandbox, values } = (await req.json()) as { id: string; enabled?: boolean; sandbox?: boolean; values?: Record<string, string> };
  const g = gatewayById(id);
  if (!g) return Response.json({ error: "Unknown gateway" }, { status: 400 });
  const cur = await getGatewayConfig(id);
  const merged = { ...cur.values };
  for (const [k, v] of Object.entries(values ?? {})) if (v !== "••••••••") merged[k] = v; // masked = unchanged
  await setGatewayConfig(id, { enabled: enabled ?? cur.enabled, sandbox: sandbox ?? cur.sandbox, values: merged });
  await audit(actor.id, "gateway.set", id, JSON.stringify({ enabled: enabled ?? cur.enabled, sandbox: sandbox ?? cur.sandbox }));
  return Response.json({ gateways: await gatewayStatus() });
});
