import { Gateway, returnUrl } from "./types";

/** shurjoPay hosted checkout (bKash, Nagad, Rocket, cards, banks). Docs: https://shurjopay.com.bd/developers */
const base = (sandbox: boolean) => (sandbox ? "https://sandbox.shurjopayment.com" : "https://engine.shurjopayment.com");

async function token(cfg: { sandbox: boolean; values: Record<string, string> }) {
  const r = await fetch(`${base(cfg.sandbox)}/api/get_token`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: cfg.values.username, password: cfg.values.password }) });
  const j = (await r.json()) as { token?: string; store_id?: number | string; execute_url?: string; message?: string };
  if (!j.token) throw new Error(`shurjoPay token: ${j.message ?? r.status}`);
  return j;
}

export const shurjopay: Gateway = {
  id: "shurjopay",
  label: "shurjoPay",
  methods: "bKash, Nagad, Rocket, Upay, cards, internet banking",
  fields: [{ key: "username", label: "API username", placeholder: "sp_sandbox (sandbox)" }, { key: "password", label: "API password", secret: true }, { key: "prefix", label: "Prefix (given by shurjoPay)", placeholder: "NOK" }],
  docs: "https://shurjopay.com.bd/developers",
  async createCheckout(cfg, ctx) {
    const t = await token(cfg);
    const r = await fetch(t.execute_url ?? `${base(cfg.sandbox)}/api/secret-pay`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t.token}` }, body: JSON.stringify({
      prefix: cfg.values.prefix || "NOK", token: t.token, return_url: returnUrl(ctx, "shurjopay", "success"), cancel_url: returnUrl(ctx, "shurjopay", "cancel"), store_id: t.store_id,
      amount: ctx.amount, order_id: ctx.paymentId, currency: ctx.currency, customer_name: ctx.user.name || ctx.user.email, customer_address: "N/A", customer_phone: ctx.user.phone || "01000000000", customer_city: "Dhaka", customer_post_code: "1000", client_ip: "127.0.0.1", value1: ctx.plan.id,
    }) });
    const j = (await r.json()) as { checkout_url?: string; sp_order_id?: string; message?: string };
    if (!j.checkout_url) throw new Error(`shurjoPay: ${j.message ?? JSON.stringify(j).slice(0, 200)}`);
    return { url: j.checkout_url, providerRef: j.sp_order_id };
  },
  async verify(cfg, params, ctx) {
    if (params.outcome === "cancel") return { ok: false, status: "cancelled" };
    const spOrder = params.order_id;
    if (!spOrder) return { ok: false, status: "invalid" };
    const t = await token(cfg);
    const r = await fetch(`${base(cfg.sandbox)}/api/verification`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t.token}` }, body: JSON.stringify({ order_id: spOrder }) });
    const arr = (await r.json()) as { sp_code?: string | number; bank_trx_id?: string; amount?: number | string; customer_order_id?: string; currency?: string }[] | { sp_code?: string | number };
    const j = Array.isArray(arr) ? arr[0] : (arr as { sp_code?: string | number });
    const rec = j as { sp_code?: string | number; bank_trx_id?: string; amount?: number | string; customer_order_id?: string; currency?: string };
    const ok = String(rec.sp_code) === "1000" && (rec.customer_order_id ?? ctx.paymentId) === ctx.paymentId && Number(rec.amount ?? 0) + 0.01 >= ctx.amount;
    return { ok, status: ok ? "paid" : "failed", txnId: rec.bank_trx_id ?? spOrder, amount: Number(rec.amount ?? 0), currency: rec.currency ?? ctx.currency, raw: arr };
  },
};
