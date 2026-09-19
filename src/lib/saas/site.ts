/** Admin-editable site settings: support contacts, payment instructions (bKash/Nagad/Rocket/QR/bank), FAQ, verification policy. */
import { getDB } from "./db";

/** Optional banners/ads shown to free users (or everyone) — e.g. sponsors, own promotions, partner offers. */
export interface Promo {
  id: string;
  enabled: boolean;
  title: string;
  text: string;
  linkUrl: string;
  linkLabel: string;
  image: string; // https URL or small data: URL (≤ 300 KB)
  placement: "chat" | "sidebar" | "share"; // above the chat box · in the sidebar · on public shared-chat pages
  audience: "free" | "everyone"; // free & signed-out users only, or all customers (staff never see ads)
  startsAt: string; // YYYY-MM-DD or ""
  endsAt: string;
  dismissible: boolean;
  sponsored: boolean; // shows a small "Sponsored" label
}

export interface SiteSettings {
  appName: string;
  supportEmail: string;
  supportPhone: string;
  whatsapp: string;
  requireEmailVerification: "auto" | "always" | "never"; // auto = when an email API key is configured
  payment: { bkash: string; nagad: string; rocket: string; bank: string; qrImage: string; note: string; currency: string; conversion: number /* price × conversion = local amount */ };
  faq: string; // markdown
  cancellationPolicy: string; // markdown
  companyName: string;
  companyAddress: string;
  /** shown on receipts; all optional and can be filled in later */
  billing: { phone: string; tradeLicense: string; bin: string; vatPercent: number; pricesIncludeVat: boolean; receiptNote: string };
  terms: string; // markdown
  privacy: string; // markdown
  refundPolicy: string; // markdown
  promos: Promo[];
}

export const DEFAULT_SITE: SiteSettings = {
  appName: "CivilMate",
  supportEmail: "",
  supportPhone: "",
  whatsapp: "",
  requireEmailVerification: "auto",
  payment: { bkash: "", nagad: "", rocket: "", bank: "", qrImage: "", note: "Send the exact amount, then submit the Transaction ID below. Plans are activated within 24 hours after we verify the payment.", currency: "BDT", conversion: 1 },
  faq: `## Frequently asked questions

**What is CivilMate?** An assistant for civil, structural and construction engineers and architects. Calculations are done by verified engineering code; the AI explains, selects the right calculator and draws.

**Is it free?** Calculators, drawings and the code library are free and unlimited. The AI assistant has a free monthly allowance of AI credits; Pro, Max and Team plans give more credits, stronger models and the offline desktop model.

**What are AI credits?** Each AI answer uses credits according to the model you pick and how much it has to read and write. A typical engineering question uses about 2 credits on GPT-OSS 120B, about 4 on Gemini Flash-Lite and about 10 on Gemini 3.8 Flash. The chooser under the chat box shows the typical cost of each model, and your remaining credits.

**Can I use my credits any time in the month?** Yes. Your monthly credits can be spent whenever you need them, with two limits so a single day cannot use everything: a limit per 5-hour session (the session starts with your first question) and a weekly limit. Your Account page shows all three with the time each one refills. An answer that has started always finishes, even if it goes slightly over. The offline model in the desktop app does not use credits.

**How do I pay?** bKash / Nagad / Rocket / Bangla QR / bank transfer (see the Subscribe page). Submit your transaction ID and we activate the plan after verification.

**How do I cancel?** Plans are prepaid for a period and do not auto-renew. Simply don't renew; your account returns to Free when the period ends. Refunds are handled through support tickets.

**Are the results safe to build from?** No. They are preliminary. A licensed engineer must verify every design against the applicable local code.`,
  cancellationPolicy: "Prepaid plans end automatically at the expiry date; there is no auto-renewal and nothing to cancel. Refund requests within 7 days of payment are considered case by case, open a support ticket with your transaction ID.",
  companyName: "",
  companyAddress: "",
  billing: { phone: "", tradeLicense: "", bin: "", vatPercent: 0, pricesIncludeVat: true, receiptNote: "Thank you for your business. This is a computer-generated receipt and needs no signature." },
  promos: [],
  terms: `## Terms of Service

1. **Service.** CivilMate provides engineering calculators, drawing generators, a building-code reference library and an AI assistant for civil, structural and construction professionals. Outputs are preliminary aids: every design must be checked and approved by a licensed engineer against the applicable local code before use in construction. We accept no liability for construction decisions.
2. **Accounts.** You must provide a valid email address, keep your password confidential and be at least 18 years old. Staff of a Team plan are added by the team owner.
3. **Plans and payment.** Paid plans are prepaid for the stated period (usually 30 days) and activate after payment confirmation. Prices are shown in Bangladeshi Taka (BDT) including applicable taxes unless stated otherwise; international card payments may be charged in USD. Plans do not renew automatically unless you enable a recurring card subscription.
4. **Fair use.** Monthly AI credit allowances, with weekly and per-session limits, apply per plan. Automated bulk use, resale of access or attempts to extract provider API keys are prohibited.
5. **Data.** Conversations are stored on your device, not on our servers (see the Privacy Policy). Account, payment and usage records are kept for billing and legal purposes.
6. **Changes and termination.** We may update features and prices with notice on the website. Either party may end the service; prepaid periods remain valid until expiry. Accounts breaching these terms may be suspended.
7. **Governing law.** These terms are governed by the laws of Bangladesh.`,
  privacy: `## Privacy Policy

- **What we collect:** name, email address, password (hashed), plan and payment records (transaction IDs, amounts, never card numbers, which are handled by the payment gateway), support tickets, and daily usage counters.
- **What we do not store:** your chat conversations. They stay in your browser or desktop app. Requests to the AI assistant are sent to the AI provider selected by your plan (for example Google, Groq, Alibaba Cloud, Anthropic) to generate the answer and are subject to that provider's API terms; we do not use them for training.
- **Cookies:** one session cookie to keep you signed in; no advertising trackers.
- **Emails:** verification codes, payment confirmations, renewal reminders and support replies only.
- **Security:** encrypted connections (HTTPS), hashed passwords, encrypted API credentials, optional two-factor authentication.
- **Your rights:** you can export or delete your chats at any time from the app; to delete your account and records, contact support.
- **Contact:** see the Help page.`,
  refundPolicy: `## Refund & Cancellation Policy

- Plans are prepaid for a fixed period and **do not auto-renew** (unless you enabled a recurring card subscription, which you can cancel any time from the Account page or by contacting support; cancellation stops future charges and the current period runs to its end).
- If a payment was made by mistake or the service could not be activated, request a refund within **7 days** of payment through a support ticket with your transaction ID. Approved refunds are returned to the original payment method (bKash/Nagad/Rocket/bank/card) within 7–10 working days.
- Refunds are not given for unused days of a period already started, or for accounts suspended for breach of the Terms of Service.
- Gateway fees deducted by the payment provider may be non-refundable.`,
};

export async function getSite(): Promise<SiteSettings> {
  const raw = await (await getDB()).getSetting("site");
  if (!raw) return DEFAULT_SITE;
  try { const s = JSON.parse(raw) as Partial<SiteSettings>; return { ...DEFAULT_SITE, ...s, payment: { ...DEFAULT_SITE.payment, ...(s.payment ?? {}) }, billing: { ...DEFAULT_SITE.billing, ...(s.billing ?? {}) } }; } catch { return DEFAULT_SITE; }
}
export async function setSite(s: SiteSettings) { await (await getDB()).setSetting("site", JSON.stringify(s)); }
