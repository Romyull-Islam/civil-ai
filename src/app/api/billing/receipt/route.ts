/** Receipt data for one payment: the owner, or staff with the payments area, may read it. */
import { getSessionUser, getPlans, getCreditPacks } from "@/lib/saas/service";
import { getDB } from "@/lib/saas/db";
import { getSite } from "@/lib/saas/site";
import { AREA_ROLES } from "@/lib/saas/admin";
import { vatBreakdown, purchaseLabel, receiptNo, methodLabel } from "@/lib/saas/billing";
export const runtime = "nodejs";
export async function GET(req: Request) {
  const user = await getSessionUser(req);
  if (!user) return Response.json({ error: "Sign in first" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id") ?? "";
  const p = await (await getDB()).getPayment(id);
  const staff = AREA_ROLES.payments.includes(user.role);
  if (!p || (p.userId !== user.id && !staff)) return Response.json({ error: "Receipt not found" }, { status: 404 });
  if (p.status !== "approved" && p.status !== "refunded") return Response.json({ error: "A receipt is issued once the payment is confirmed." }, { status: 409 });
  const [site, plans, packs] = await Promise.all([getSite(), getPlans(), getCreditPacks()]);
  return Response.json({
    receipt: {
      no: receiptNo(p), date: p.reviewedAt ?? p.createdAt, status: p.status,
      seller: { name: site.companyName || site.appName, address: site.companyAddress, phone: site.billing.phone, email: site.supportEmail, tradeLicense: site.billing.tradeLicense, bin: site.billing.bin, app: site.appName },
      customer: { email: p.email },
      item: purchaseLabel(p, plans, packs), carriedDays: p.carriedDays ?? 0,
      method: methodLabel(p.method, p.txnId), reference: p.txnId, currency: p.currency,
      ...vatBreakdown(p.amount, site.billing.vatPercent, site.billing.pricesIncludeVat), vatPercent: site.billing.vatPercent, pricesIncludeVat: site.billing.pricesIncludeVat,
      note: site.billing.receiptNote,
    },
  });
}
