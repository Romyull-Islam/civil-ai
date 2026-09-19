/** Extra-credit packs (admin → Plans). */
import { guardArea } from "@/lib/saas/admin";
import { getCreditPacks, setCreditPacks } from "@/lib/saas/service";
import { DEFAULT_CREDIT_PACKS, type CreditPack } from "@/lib/saas/plans";
import { audit } from "@/lib/saas/security";
export const runtime = "nodejs";
export const GET = guardArea("plans", async () => Response.json({ packs: await getCreditPacks(), defaults: DEFAULT_CREDIT_PACKS }));
export const POST = guardArea("plans", async (req, actor) => {
  const { packs } = (await req.json()) as { packs: CreditPack[] };
  const ok = Array.isArray(packs) && packs.every((p) => /^[a-z0-9_-]{1,24}$/.test(p.id) && p.name && p.price > 0 && p.credits > 0 && p.validityDays > 0);
  if (!ok || new Set(packs.map((p) => p.id)).size !== packs.length) return Response.json({ error: "Each pack needs a unique id (a-z, 0-9), a name, and a price, credits and validity above zero." }, { status: 400 });
  await setCreditPacks(packs.map((p) => ({ id: p.id, name: p.name.slice(0, 40), price: Number(p.price), currency: p.currency || "BDT", credits: Number(p.credits), validityDays: Math.round(Number(p.validityDays)) })));
  await audit(actor.id, "packs.set", "", `${packs.length} packs`);
  return Response.json({ packs: await getCreditPacks() });
});
