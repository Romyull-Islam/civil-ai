import { getSessionUser } from "@/lib/saas/service";
import { getDB } from "@/lib/saas/db";
import { putSave, readSave, quotaFor } from "@/lib/saas/saves";
import { appMode } from "@/lib/saas/mode";
export const runtime = "nodejs";
const auth = async (req: Request) => (appMode() === "saas" ? getSessionUser(req) : null);

export async function GET(req: Request) {
  const u = await auth(req);
  if (!u) return Response.json({ error: "Sign in first" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (id) { const r = await readSave(u, id); return r ? Response.json(r) : Response.json({ error: "Not found" }, { status: 404 }); }
  return Response.json({ items: await (await getDB()).listSaves(u.id), quota: await quotaFor(u) });
}
export async function POST(req: Request) {
  const u = await auth(req);
  if (!u) return Response.json({ error: "Sign in first" }, { status: 401 });
  try { const body = await req.json(); return Response.json(await putSave(u, body), { status: 201 }); }
  catch (e) { return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 }); }
}
export async function DELETE(req: Request) {
  const u = await auth(req);
  if (!u) return Response.json({ error: "Sign in first" }, { status: 401 });
  const { id } = (await req.json()) as { id: string };
  await (await getDB()).deleteSave(u.id, id);
  return Response.json({ ok: true, quota: await quotaFor(u) });
}
