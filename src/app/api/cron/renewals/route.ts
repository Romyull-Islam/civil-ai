/** Daily job: renewal reminder emails. Vercel Cron calls this with `Authorization: Bearer $CRON_SECRET`; admins can trigger it from the panel. */
import { runRenewalReminders } from "@/lib/saas/renewals";
import { sweepPendingPayments } from "@/lib/saas/checkout";
import { getSessionUser } from "@/lib/saas/service";
export const runtime = "nodejs";
export const maxDuration = 120;
export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  const cronOk = !!process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`;
  const user = cronOk ? null : await getSessionUser(req);
  if (!cronOk && !(user && (user.role === "superadmin" || user.role === "admin"))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const base = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;
  const reminders = await runRenewalReminders(base);
  const payments = await sweepPendingPayments(base);
  return Response.json({ ...reminders, payments });
}
