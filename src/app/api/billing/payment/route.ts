/** Status of one of the user's payments (polled by the result page), and "check again" for pending online payments. */
import { getSessionUser } from "@/lib/saas/service";
import { getDB, type Payment } from "@/lib/saas/db";
import { recheckPayment } from "@/lib/saas/checkout";
export const runtime = "nodejs";

async function own(req: Request, ref: string | null): Promise<Payment | null | "auth"> {
  const user = await getSessionUser(req);
  if (!user) return "auth";
  if (!ref) return null;
  const db = await getDB();
  const p = (await db.getPayment(ref)) ?? (await db.getPaymentByTxn(ref));
  return p && p.userId === user.id ? p : null;
}
const view = (p: Payment) => ({ id: p.id, status: p.status, plan: p.plan, amount: p.amount, currency: p.currency, method: p.method, ref: p.txnId, createdAt: p.createdAt, carriedDays: p.carriedDays ?? 0 });

export async function GET(req: Request) {
  const p = await own(req, new URL(req.url).searchParams.get("pid"));
  if (p === "auth") return Response.json({ error: "Sign in first" }, { status: 401 });
  return p ? Response.json({ payment: view(p) }) : Response.json({ error: "Payment not found" }, { status: 404 });
}
export async function POST(req: Request) {
  const { pid } = (await req.json().catch(() => ({}))) as { pid?: string };
  const p = await own(req, pid ?? null);
  if (p === "auth") return Response.json({ error: "Sign in first" }, { status: 401 });
  if (!p) return Response.json({ error: "Payment not found" }, { status: 404 });
  await recheckPayment(p, process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin).catch(() => {});
  const fresh = await (await getDB()).getPayment(p.id);
  return Response.json({ payment: view(fresh ?? p) });
}
