import { guardArea } from "@/lib/saas/admin";
import { gatewayStatus, getGatewayConfig, setGatewayConfig, gatewayById } from "@/lib/saas/gateways";
import { audit } from "@/lib/saas/security";
export const runtime = "nodejs";
const callbacks = (base: string) => ({ base, returnUrl: `${base}/api/checkout/return/<gateway>`, sslcommerzIpn: `${base}/api/checkout/ipn/sslcommerz`, stripeWebhook: `${base}/api/webhooks/stripe`, genericWebhook: `${base}/api/webhooks/payment` });
export const GET = guardArea("keys", async (req) => Response.json({ gateways: await gatewayStatus(), callbacks: callbacks(process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin), appUrlSet: !!process.env.NEXT_PUBLIC_APP_URL }));
export const POST = guardArea("keys", async (req, actor) => {
  const { id, enabled, sandbox, values, useSandboxValues } = (await req.json()) as { id: string; enabled?: boolean; sandbox?: boolean; values?: Record<string, string>; useSandboxValues?: boolean };
  const g = gatewayById(id);
  if (!g) return Response.json({ error: "Unknown gateway" }, { status: 400 });
  const cur = await getGatewayConfig(id);
  // "Use public test credentials": fill the documented sandbox account and force test mode.
  if (useSandboxValues && g.sandboxValues) {
    await setGatewayConfig(id, { enabled: true, sandbox: true, values: { ...g.sandboxValues } });
    await audit(actor.id, "gateway.sandbox", id, "public sandbox credentials");
    return Response.json({ gateways: await gatewayStatus() });
  }
  const merged = { ...cur.values };
  for (const [k, v] of Object.entries(values ?? {})) if (v !== "••••••••") merged[k] = v; // masked = unchanged
  await setGatewayConfig(id, { enabled: enabled ?? cur.enabled, sandbox: sandbox ?? cur.sandbox, values: merged });
  await audit(actor.id, "gateway.set", id, JSON.stringify({ enabled: enabled ?? cur.enabled, sandbox: sandbox ?? cur.sandbox }));
  return Response.json({ gateways: await gatewayStatus() });
});
