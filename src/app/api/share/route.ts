import { getSessionUser, needsVerification } from "@/lib/saas/service";
import { getDB } from "@/lib/saas/db";
import { createShare, readShare, SHARE_DAYS } from "@/lib/saas/shares";
import { hasAccounts } from "@/lib/saas/mode";
import { rateLimit } from "@/lib/saas/security";
export const runtime = "nodejs";

/** GET ?id= → public read-only conversation.  GET (signed in, no id) → my active links. */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (id) { const r = await readShare(id); return r ? Response.json(r) : Response.json({ error: "This link has expired or was removed." }, { status: 404 }); }
  const u = hasAccounts() ? await getSessionUser(req) : null;
  if (!u) return Response.json({ error: "Sign in first" }, { status: 401 });
  return Response.json({ shares: (await (await getDB()).listShares(u.id)).filter((s) => s.expiresAt > Date.now()), days: SHARE_DAYS });
}
export async function POST(req: Request) {
  if (!hasAccounts()) return Response.json({ error: "Share links are available in the online version" }, { status: 400 });
  const u = await getSessionUser(req);
  if (!u) return Response.json({ error: "Sign in to create a share link" }, { status: 401 });
  if (await needsVerification(u)) return Response.json({ error: "Please verify your email address first." }, { status: 403 });
  if (!rateLimit(`share:${u.id}`, 30, 3600000)) return Response.json({ error: "Too many share links in the last hour" }, { status: 429 });
  try { const { conversation } = (await req.json()) as { conversation: { title?: string; messages?: [] } }; return Response.json(await createShare(u, conversation), { status: 201 }); }
  catch (e) { return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 }); }
}
export async function DELETE(req: Request) {
  const u = hasAccounts() ? await getSessionUser(req) : null;
  if (!u) return Response.json({ error: "Sign in first" }, { status: 401 });
  const { id } = (await req.json()) as { id: string };
  await (await getDB()).deleteShare(u.id, id);
  return Response.json({ ok: true });
}
