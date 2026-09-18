import { getSessionUser, totpSetupStart, totpSetupConfirm, totpDisable, totpEnabled } from "@/lib/saas/service";
import { isStaff } from "@/lib/saas/db";
export const runtime = "nodejs";
export async function GET(req: Request) { const u = await getSessionUser(req); if (!u) return Response.json({ error: "Sign in first" }, { status: 401 }); return Response.json({ enabled: await totpEnabled(u.id), staff: isStaff(u.role) }); }
export async function POST(req: Request) {
  const u = await getSessionUser(req);
  if (!u) return Response.json({ error: "Sign in first" }, { status: 401 });
  const { action, code, password } = (await req.json()) as { action: "start" | "confirm" | "disable"; code?: string; password?: string };
  try {
    if (action === "start") return Response.json(await totpSetupStart(u));
    if (action === "confirm") { await totpSetupConfirm(u, String(code ?? "")); return Response.json({ ok: true }); }
    if (action === "disable") { await totpDisable(u, String(password ?? "")); return Response.json({ ok: true }); }
    return Response.json({ error: "unknown action" }, { status: 400 });
  } catch (e) { return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 }); }
}
