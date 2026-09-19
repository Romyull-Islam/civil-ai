import { guardArea } from "@/lib/saas/admin";
import { getDB } from "@/lib/saas/db";
import { reviewPayment, refundPayment } from "@/lib/saas/service";
import { audit } from "@/lib/saas/security";
export const runtime = "nodejs";
export const GET = guardArea("payments", async (req) => { const status = new URL(req.url).searchParams.get("status") || undefined; return Response.json({ payments: await (await getDB()).listPayments({ status, limit: 1000 }) }); });
export const PATCH = guardArea("payments", async (req, actor) => {
  const { id, status, note, revoke } = (await req.json()) as { id: string; status: "approved" | "rejected" | "refunded"; note?: string; revoke?: boolean };
  const p = status === "refunded" ? await refundPayment(id, !!revoke, note) : await reviewPayment(id, status, note);
  if (p) await audit(actor.id, `payment.${status}`, p.email, `${p.plan} ${p.method} ${p.txnId}`);
  return p ? Response.json({ payment: p }) : Response.json({ error: "Not found" }, { status: 404 });
});
