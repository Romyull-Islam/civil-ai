/** Admin/helpdesk dashboard: today's work, setup checklist and what each plan offers. */
import { guardArea } from "@/lib/saas/admin";
import { getDB } from "@/lib/saas/db";
import { getPlans, keyStatus, totpEnabled, today } from "@/lib/saas/service";
import { planModels } from "@/lib/saas/plans";
import { getSite } from "@/lib/saas/site";
import { emailConfigured } from "@/lib/saas/email";
import { enabledGateways } from "@/lib/saas/gateways";
import { friendlyModel } from "@/lib/ai/friendly";
import { PROVIDERS } from "@/lib/ai/registry";
import { CLOUD_TOTAL_CAP_MB } from "@/lib/saas/saves";
export const runtime = "nodejs";

export const GET = guardArea("users", async (_req, actor) => {
  const db = await getDB();
  const [users, plans, pending, open, byDay, cloud] = await Promise.all([db.listUsers(5000), getPlans(), db.listPayments({ status: "pending", limit: 500 }), db.listTickets({ status: "open", limit: 500 }), db.usageByDay(7), db.savesTotal()]);
  const now = Date.now();
  const paid = users.filter((u) => u.plan !== "free" && (!u.planExpires || u.planExpires > now));
  const counts = {
    users: users.length,
    paidUsers: paid.length,
    newThisWeek: users.filter((u) => now - u.createdAt < 7 * 86400000).length,
    pendingPayments: pending.length,
    openTickets: open.length,
    requestsToday: byDay.find((d) => d.day === today())?.requests ?? 0,
    requests7d: byDay.reduce((a, d) => a + d.requests, 0),
    cloudMB: Math.round((cloud.bytes / 1048576) * 10) / 10,
    cloudCapMB: CLOUD_TOTAL_CAP_MB,
  };
  const staffAdmin = actor.role === "superadmin" || actor.role === "admin";
  if (!staffAdmin) return Response.json({ counts });

  const keys = await keyStatus();
  const hasKey = (p: string) => p === "local" || p === "ollama" || !!(keys[p]?.set || keys[p]?.fromEnv);
  const site = await getSite();
  const gateways = await enabledGateways();
  const manualPay = [site.payment.bkash, site.payment.nagad, site.payment.rocket, site.payment.bank, site.payment.qrImage].some(Boolean);
  const label = (p: string, m: string) => PROVIDERS.find((x) => x.id === p)?.models.find((x) => x.id === m)?.label;
  const planSummary = plans.map((p) => ({
    id: p.id, name: p.name, price: p.priceMonthly, currency: p.currency, monthlyCredits: p.monthlyCredits, weeklyCredits: p.weeklyCredits, sessionCredits: p.sessionCredits, sessionHours: p.sessionHours ?? 5, perSeat: !!p.perSeat, localAI: p.localAI, cloudMB: p.cloudStorageMB ?? 0,
    models: planModels(p).map((m) => ({ ...m, ...friendlyModel(m.provider, m.model, label(m.provider, m.model)), hasKey: hasKey(m.provider) })),
  }));
  const keysReady = Object.entries(keys).filter(([, v]) => v.set || v.fromEnv).map(([k]) => k);
  const checklist = [
    { id: "email", ok: emailConfigured(), title: "Email sending", detail: emailConfigured() ? "Verification codes and receipts are emailed" : "Set SMTP_* (Gmail app password) in the hosting environment", tab: "site" },
    { id: "keys", ok: keysReady.length > 0, title: "AI provider keys", detail: keysReady.length ? `Keys set: ${keysReady.join(", ")}` : "Add at least a free Gemini or Groq key", tab: "keys" },
    { id: "plans", ok: planSummary.every((p) => p.models.some((m) => m.hasKey)), title: "Every plan has a working model", detail: planSummary.filter((p) => !p.models.some((m) => m.hasKey)).map((p) => p.name).join(", ") || "All plans can answer", tab: "plans" },
    { id: "payment", ok: gateways.length > 0 || manualPay, title: "Payment method", detail: gateways.length ? `Online: ${gateways.map((g) => g.label + (g.sandbox ? " (test mode)" : "")).join(", ")}` : manualPay ? "Manual transfer numbers set; online gateway not enabled" : "Add SSLCommerz credentials or bKash/Nagad numbers", tab: gateways.length ? "gateways" : "site" },
    { id: "live", ok: gateways.length === 0 || gateways.every((g) => !g.sandbox), title: "Payments in live mode", detail: gateways.some((g) => g.sandbox) ? "A gateway is still in sandbox/test mode" : "Live", tab: "gateways" },
    { id: "support", ok: !!site.supportEmail, title: "Support contact", detail: site.supportEmail || "Add a support email shown on Help and receipts", tab: "site" },
    { id: "company", ok: !!site.companyName, title: "Company name on legal pages", detail: site.companyName || "Required by SSLCommerz for merchant approval", tab: "site" },
    { id: "url", ok: !!process.env.NEXT_PUBLIC_APP_URL, title: "Public site address", detail: process.env.NEXT_PUBLIC_APP_URL || "Set NEXT_PUBLIC_APP_URL (used in emails and payment returns)", tab: "site" },
    { id: "2fa", ok: await totpEnabled(actor.id), title: "Two-factor login on your account", detail: "Protects the admin panel", tab: "account" },
  ];
  return Response.json({ counts, checklist, planSummary });
});
