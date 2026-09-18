import { getSessionUser } from "@/lib/saas/service";
import { startCheckout } from "@/lib/saas/checkout";
import { appMode } from "@/lib/saas/mode";
export const runtime = "nodejs";
export async function POST(req: Request) {
  if (appMode() !== "saas") return Response.json({ error: "Not in SaaS mode" }, { status: 400 });
  const user = await getSessionUser(req);
  if (!user) return Response.json({ error: "Sign in first" }, { status: 401 });
  try {
    const { plan, gateway, seats } = (await req.json()) as { plan: string; gateway: string; seats?: number };
    const base = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;
    return Response.json(await startCheckout(user, plan, gateway, base, seats));
  } catch (e) { return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 }); }
}
