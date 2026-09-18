import { createHmac, timingSafeEqual } from "node:crypto";
import { Gateway, form, returnUrl } from "./types";

/** Stripe Checkout (international cards, Apple/Google Pay). One-off payment per plan period; recurring via webhook `invoice.paid` when `recurring` = "yes". */
const api = async (key: string, path: string, body?: string, method = "POST") => {
  const r = await fetch(`https://api.stripe.com/v1${path}`, { method, headers: { Authorization: `Bearer ${key}`, ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) }, body });
  const j = await r.json();
  if (!r.ok) throw new Error(`Stripe: ${(j as { error?: { message?: string } }).error?.message ?? r.status}`);
  return j as Record<string, unknown>;
};

export const stripe: Gateway = {
  id: "stripe",
  label: "Stripe (cards, international)",
  methods: "Visa/Mastercard/Amex worldwide, Apple Pay, Google Pay",
  fields: [{ key: "secret_key", label: "Secret key (sk_test_… / sk_live_…)", secret: true }, { key: "webhook_secret", label: "Webhook signing secret (whsec_…), optional, for auto-renewal", secret: true }, { key: "recurring", label: "Recurring monthly subscription? (yes/no)", placeholder: "no" }],
  docs: "https://docs.stripe.com/payments/checkout",
  async createCheckout(cfg, ctx) {
    const recurring = /^y/i.test(cfg.values.recurring ?? "");
    const params: Record<string, string | number> = {
      mode: recurring ? "subscription" : "payment",
      success_url: `${returnUrl(ctx, "stripe", "success")}&session_id={CHECKOUT_SESSION_ID}`, cancel_url: returnUrl(ctx, "stripe", "cancel"),
      customer_email: ctx.user.email, client_reference_id: ctx.paymentId, "metadata[plan]": ctx.plan.id, "metadata[paymentId]": ctx.paymentId, "metadata[email]": ctx.user.email,
      "line_items[0][quantity]": 1, "line_items[0][price_data][currency]": ctx.currency.toLowerCase(), "line_items[0][price_data][unit_amount]": Math.round(ctx.amount * 100), "line_items[0][price_data][product_data][name]": `${ctx.plan.name} plan`,
    };
    if (recurring) { params["line_items[0][price_data][recurring][interval]"] = "month"; params["subscription_data[metadata][plan]"] = ctx.plan.id; params["subscription_data[metadata][email]"] = ctx.user.email; }
    const j = await api(cfg.values.secret_key, "/checkout/sessions", form(params));
    return { url: String(j.url), providerRef: String(j.id) };
  },
  async verify(cfg, params, ctx) {
    if (params.outcome === "cancel") return { ok: false, status: "cancelled" };
    const id = params.session_id;
    if (!id) return { ok: false, status: "invalid" };
    const j = await api(cfg.values.secret_key, `/checkout/sessions/${id}`, undefined, "GET");
    const ok = (j.payment_status === "paid" || j.status === "complete") && j.client_reference_id === ctx.paymentId;
    return { ok, status: ok ? "paid" : "pending", txnId: String(j.payment_intent ?? j.subscription ?? id), amount: Number(j.amount_total ?? 0) / 100, currency: String(j.currency ?? ctx.currency).toUpperCase(), raw: j };
  },
};

/** Verify a Stripe webhook signature (Stripe-Signature: t=…,v1=…). */
export function verifyStripeSignature(payload: string, header: string | null, secret: string, toleranceSec = 300): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const t = Number(parts.t); if (!t || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  const given = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  return given.some((g) => g.length === expected.length && timingSafeEqual(Buffer.from(g), Buffer.from(expected)));
}
