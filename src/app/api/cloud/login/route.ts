import { appMode } from "@/lib/saas/mode";
import { cloudLogin, cloudMe } from "@/lib/saas/cloud";
export const runtime = "nodejs";
export async function POST(req: Request) {
  if (appMode() === "saas") return Response.json({ error: "Not available on the hosted service" }, { status: 400 });
  try {
    const { backendUrl, email, password } = (await req.json()) as { backendUrl: string; email: string; password: string };
    const link = await cloudLogin(backendUrl, email, password);
    const me = await cloudMe(link);
    return Response.json({ ok: true, backendUrl: link.backendUrl, email: link.email, ...me });
  } catch (e) { return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 }); }
}
