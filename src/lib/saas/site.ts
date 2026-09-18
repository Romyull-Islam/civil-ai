/** Admin-editable site settings: support contacts, payment instructions (bKash/Nagad/Rocket/QR/bank), FAQ, verification policy. */
import { getDB } from "./db";

export interface SiteSettings {
  appName: string;
  supportEmail: string;
  supportPhone: string;
  whatsapp: string;
  requireEmailVerification: "auto" | "always" | "never"; // auto = when an email API key is configured
  payment: { bkash: string; nagad: string; rocket: string; bank: string; qrImage: string; note: string; currency: string; conversion: number /* price × conversion = local amount */ };
  faq: string; // markdown
  cancellationPolicy: string; // markdown
}

export const DEFAULT_SITE: SiteSettings = {
  appName: "Civil AI",
  supportEmail: "",
  supportPhone: "",
  whatsapp: "",
  requireEmailVerification: "auto",
  payment: { bkash: "", nagad: "", rocket: "", bank: "", qrImage: "", note: "Send the exact amount, then submit the Transaction ID below. Plans are activated within 24 hours after we verify the payment.", currency: "BDT", conversion: 1 },
  faq: `## Frequently asked questions

**What is Civil AI?** An assistant for civil, structural and construction engineers and architects. Calculations are done by verified engineering code; the AI explains, selects the right calculator and draws.

**Is it free?** Calculators, drawings and the code library are free. The AI assistant has a free daily allowance; Pro and Business plans give more requests, stronger models and the offline desktop model.

**How do I pay?** bKash / Nagad / Rocket / Bangla QR / bank transfer (see the Subscribe page). Submit your transaction ID and we activate the plan after verification.

**How do I cancel?** Plans are prepaid for a period and do not auto-renew. Simply don't renew; your account returns to Free when the period ends. Refunds are handled through support tickets.

**Are the results safe to build from?** No. They are preliminary. A licensed engineer must verify every design against the applicable local code.`,
  cancellationPolicy: "Prepaid plans end automatically at the expiry date; there is no auto-renewal and nothing to cancel. Refund requests within 7 days of payment are considered case by case — open a support ticket with your transaction ID.",
};

export async function getSite(): Promise<SiteSettings> {
  const raw = await (await getDB()).getSetting("site");
  if (!raw) return DEFAULT_SITE;
  try { const s = JSON.parse(raw) as Partial<SiteSettings>; return { ...DEFAULT_SITE, ...s, payment: { ...DEFAULT_SITE.payment, ...(s.payment ?? {}) } }; } catch { return DEFAULT_SITE; }
}
export async function setSite(s: SiteSettings) { await (await getDB()).setSetting("site", JSON.stringify(s)); }
