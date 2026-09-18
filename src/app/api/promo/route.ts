/** Active banners for the current viewer (GET) and view/click counters (POST). Staff never see ads. */
import { getSite } from "@/lib/saas/site";
import { getDB } from "@/lib/saas/db";
import { getSessionUser, planFor } from "@/lib/saas/service";
import { appMode } from "@/lib/saas/mode";
import { rateLimit, clientIp } from "@/lib/saas/security";
export const runtime = "nodejs";

export async function GET(req: Request) {
  if (appMode() !== "saas") return Response.json({ promos: [] });
  const placement = new URL(req.url).searchParams.get("placement") ?? "chat";
  const user = await getSessionUser(req);
  if (user && user.role !== "user") return Response.json({ promos: [] });
  const free = !user || (await planFor(user)).priceMonthly === 0;
  const today = new Date().toISOString().slice(0, 10);
  const promos = (await getSite()).promos.filter((p) => p.enabled && p.placement === placement && (p.audience === "everyone" || free) && (!p.startsAt || p.startsAt <= today) && (!p.endsAt || p.endsAt >= today) && (p.title || p.text || p.image));
  return Response.json({ promos: promos.map(({ id, title, text, linkUrl, linkLabel, image, dismissible, sponsored }) => ({ id, title, text, linkUrl, linkLabel, image, dismissible, sponsored })) }, { headers: { "Cache-Control": "private, max-age=60" } });
}

export async function POST(req: Request) {
  const { id, event } = (await req.json().catch(() => ({}))) as { id?: string; event?: string };
  if (!id || !/^[a-z0-9-]{3,40}$/i.test(id) || (event !== "view" && event !== "click")) return Response.json({ ok: false }, { status: 400 });
  if (!rateLimit(`promo:${clientIp(req)}`, 300, 3600000)) return Response.json({ ok: false }, { status: 429 });
  const db = await getDB();
  const key = `promo-stat:${id}`;
  const cur = JSON.parse((await db.getSetting(key)) || '{"views":0,"clicks":0}') as { views: number; clicks: number };
  if (event === "view") cur.views++; else cur.clicks++;
  await db.setSetting(key, JSON.stringify(cur));
  return Response.json({ ok: true });
}
