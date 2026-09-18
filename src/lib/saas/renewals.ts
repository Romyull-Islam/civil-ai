/**
 * Renewal reminders (no auto-charge is possible with manual bKash/Nagad transfers): email at 7 days, 1 day before expiry,
 * and when the grace period starts. Each stage is sent once per expiry date. Run daily via /api/cron/renewals (Vercel Cron)
 * or the in-process scheduler on self-hosted servers.
 */
import { getDB } from "./db";
import { getPlans, renewalState } from "./service";
import { sendEmail } from "./email";
import { getSite } from "./site";

export async function runRenewalReminders(baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? ""): Promise<{ checked: number; sent: string[] }> {
  const db = await getDB();
  const plans = await getPlans();
  const site = await getSite();
  const sent: string[] = [];
  const users = await db.listUsers(5000);
  for (const u of users) {
    if (!u.planExpires || u.disabled) continue;
    const plan = plans.find((p) => p.id === u.plan);
    if (!plan || plan.priceMonthly === 0) continue;
    const st = renewalState(u, plan);
    const stage = st.status === "expiring" && st.daysLeft! <= 1 ? "1d" : st.status === "expiring" ? "7d" : st.status === "grace" ? "grace" : null;
    if (!stage) continue;
    const key = `remind:${u.id}:${u.planExpires}:${stage}`;
    if (await db.getSetting(key)) continue;
    const renew = `${baseUrl}/subscribe?plan=${plan.id}`;
    const text = stage === "grace"
      ? `Your ${plan.name} plan expired on ${new Date(u.planExpires).toDateString()}. It keeps working for ${plan.graceDays ?? 3} more days. Renew here: ${renew}\n\nAfter that your account returns to the Free plan (your data stays).`
      : `Your ${plan.name} plan expires in ${st.daysLeft} day${st.daysLeft === 1 ? "" : "s"} (${new Date(u.planExpires).toDateString()}). Renew here: ${renew}\n\nPay by bKash / Nagad / Rocket / bank and submit the transaction ID; we activate within 24 hours.`;
    await sendEmail(u.email, `${site.appName}: ${stage === "grace" ? "plan expired, please renew" : "plan renewal reminder"}`, `Hello ${u.name || ""}\n\n${text}`);
    await db.setSetting(key, String(Date.now()));
    sent.push(`${u.email}:${stage}`);
  }
  return { checked: users.length, sent };
}

let timer: NodeJS.Timeout | null = null;
/** Self-hosted / desktop-server: run once at start and then every 24 h (Vercel uses the cron route instead). */
export function startRenewalScheduler() {
  if (timer || process.env.VERCEL) return;
  const tick = () => runRenewalReminders().catch(() => {});
  setTimeout(tick, 30000);
  timer = setInterval(tick, 24 * 3600000);
}
