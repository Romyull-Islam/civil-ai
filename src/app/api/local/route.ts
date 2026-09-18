import { status, setup, startServer, stopServer, cancelSetup, LOCAL_ENABLED } from "@/lib/local";
import { appMode } from "@/lib/saas/mode";
import { localAIAllowed } from "@/lib/saas/cloud";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET() { const ent = await localAIAllowed(appMode()); return Response.json({ ...(await status()), entitled: ent.allowed, entitlementReason: ent.reason }); }

export async function POST(req: Request) {
  if (!LOCAL_ENABLED) return Response.json({ error: "Local AI is disabled on hosted deployments" }, { status: 400 });
  const body = (await req.json()) as { action: "setup" | "start" | "stop" | "cancel"; modelId?: string; gpuBuild?: boolean };
  if (body.action === "setup" || body.action === "start") { const ent = await localAIAllowed(appMode()); if (!ent.allowed) return Response.json({ error: ent.reason }, { status: 403 }); }
  try {
    if (body.action === "setup") { void setup({ modelId: body.modelId, gpuBuild: body.gpuBuild }).catch(() => {}); return Response.json({ started: true }); }
    if (body.action === "start") { await startServer(); return Response.json(await status()); }
    if (body.action === "stop") { stopServer(); return Response.json(await status()); }
    if (body.action === "cancel") { cancelSetup(); return Response.json({ ok: true }); }
    return Response.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
