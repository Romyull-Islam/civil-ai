import { guardArea } from "@/lib/saas/admin";
import { testGateway } from "@/lib/saas/gateways";
export const runtime = "nodejs";
export const POST = guardArea("keys", async (req) => {
  const { id } = (await req.json()) as { id: string };
  return Response.json(await testGateway(id, process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin));
});
