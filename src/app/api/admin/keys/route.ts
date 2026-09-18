import { guardArea } from "@/lib/saas/admin";
import { keyStatus, setServerKey } from "@/lib/saas/service";
import { audit } from "@/lib/saas/security";
export const runtime = "nodejs";
export const GET = guardArea("keys", async () => Response.json(await keyStatus()));
export const POST = guardArea("keys", async (req, actor) => {
  const { provider, apiKey, baseUrl } = (await req.json()) as { provider: string; apiKey?: string | null; baseUrl?: string | null };
  await setServerKey(provider, apiKey ?? undefined, baseUrl);
  await audit(actor.id, "key.set", provider, apiKey === "" ? "cleared" : apiKey ? "set" : "baseUrl");
  return Response.json(await keyStatus());
});
