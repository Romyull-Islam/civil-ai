import { Gateway, form, returnUrl } from "./types";

/** aamarPay hosted checkout (bKash, Nagad, Rocket, cards, banks). Docs: https://aamarpay.readme.io/ */
export const aamarpay: Gateway = {
  id: "aamarpay",
  label: "aamarPay",
  sandboxValues: { store_id: "aamarpaytest", signature_key: "dbb74894e82415a2f7ff0ec3a97e4183" },
  methods: "bKash, Nagad, Rocket, Upay, cards, internet banking",
  fields: [{ key: "store_id", label: "Store ID", placeholder: "aamarpaytest (sandbox)" }, { key: "signature_key", label: "Signature key", secret: true }],
  docs: "https://aamarpay.readme.io/reference/initiate-payment-json",
  async createCheckout(cfg, ctx) {
    const base = cfg.sandbox ? "https://sandbox.aamarpay.com" : "https://secure.aamarpay.com";
    const r = await fetch(`${base}/jsonpost.php`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      store_id: cfg.values.store_id, signature_key: cfg.values.signature_key, tran_id: ctx.paymentId, amount: ctx.amount.toFixed(2), currency: ctx.currency,
      desc: `${ctx.plan.name} plan subscription`, cus_name: ctx.user.name || ctx.user.email, cus_email: ctx.user.email, cus_phone: ctx.user.phone || "01000000000", cus_add1: "N/A", cus_city: "Dhaka", cus_country: "Bangladesh",
      success_url: returnUrl(ctx, "aamarpay", "success"), fail_url: returnUrl(ctx, "aamarpay", "fail"), cancel_url: returnUrl(ctx, "aamarpay", "cancel"), type: "json", opt_a: ctx.plan.id,
    }) });
    const j = (await r.json()) as { result?: string | boolean; payment_url?: string; [k: string]: unknown };
    if (!j.payment_url) throw new Error(`aamarPay: ${JSON.stringify(j).slice(0, 200)}`);
    return { url: j.payment_url };
  },
  async verify(cfg, params, ctx) {
    if (params.outcome === "cancel") return { ok: false, status: "cancelled" };
    const base = cfg.sandbox ? "https://sandbox.aamarpay.com" : "https://secure.aamarpay.com";
    const r = await fetch(`${base}/api/v1/trxcheck/request.php?${form({ request_id: ctx.paymentId, store_id: cfg.values.store_id, signature_key: cfg.values.signature_key, type: "json" })}`);
    const j = (await r.json()) as { pay_status?: string; status_code?: string | number; amount?: string; mer_txnid?: string; pg_txnid?: string; currency?: string };
    const ok = (j.pay_status === "Successful" || String(j.status_code) === "2") && (j.mer_txnid ?? ctx.paymentId) === ctx.paymentId && Number(j.amount ?? 0) + 0.01 >= ctx.amount;
    return { ok, status: ok ? "paid" : params.outcome === "fail" ? "failed" : "invalid", txnId: j.pg_txnid ?? params.pg_txnid, amount: Number(j.amount ?? 0), currency: j.currency ?? ctx.currency, raw: j };
  },
};
