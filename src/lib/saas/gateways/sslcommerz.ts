import { Gateway, form, returnUrl } from "./types";

/** SSLCommerz hosted checkout (bKash, Nagad, Rocket, Upay, cards, internet banking, Bangla QR). Docs: https://developer.sslcommerz.com/doc/v4/ */
export const sslcommerz: Gateway = {
  id: "sslcommerz",
  label: "SSLCommerz",
  methods: "bKash, Nagad, Rocket, Upay, Bangla QR, Visa/Mastercard/Amex, internet banking",
  fields: [{ key: "store_id", label: "Store ID" }, { key: "store_passwd", label: "Store password", secret: true }],
  docs: "https://developer.sslcommerz.com/doc/v4/",
  async createCheckout(cfg, ctx) {
    const base = cfg.sandbox ? "https://sandbox.sslcommerz.com" : "https://securepay.sslcommerz.com";
    const body = form({
      store_id: cfg.values.store_id, store_passwd: cfg.values.store_passwd,
      total_amount: ctx.amount.toFixed(2), currency: ctx.currency, tran_id: ctx.paymentId,
      success_url: returnUrl(ctx, "sslcommerz", "success"), fail_url: returnUrl(ctx, "sslcommerz", "fail"), cancel_url: returnUrl(ctx, "sslcommerz", "cancel"),
      ipn_url: `${ctx.baseUrl}/api/checkout/ipn/sslcommerz`,
      product_name: `${ctx.plan.name} plan`, product_category: "Subscription", product_profile: "non-physical-goods",
      shipping_method: "NO", num_of_item: 1,
      cus_name: ctx.user.name || ctx.user.email, cus_email: ctx.user.email, cus_phone: ctx.user.phone || "01000000000", cus_add1: "N/A", cus_city: "Dhaka", cus_postcode: "1000", cus_country: "Bangladesh",
      value_a: ctx.plan.id,
    });
    const r = await fetch(`${base}/gwprocess/v4/api.php`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
    const j = (await r.json()) as { status?: string; GatewayPageURL?: string; failedreason?: string };
    if (j.status !== "SUCCESS" || !j.GatewayPageURL) throw new Error(`SSLCommerz: ${j.failedreason ?? j.status ?? "session failed"}`);
    return { url: j.GatewayPageURL, providerRef: j.GatewayPageURL };
  },
  async verify(cfg, params, ctx) {
    if (params.outcome === "cancel") return { ok: false, status: "cancelled" };
    const valId = params.val_id;
    if (!valId) return { ok: false, status: params.outcome === "fail" ? "failed" : "invalid" };
    const base = cfg.sandbox ? "https://sandbox.sslcommerz.com" : "https://securepay.sslcommerz.com";
    const r = await fetch(`${base}/validator/api/validationserverAPI.php?${form({ val_id: valId, store_id: cfg.values.store_id, store_passwd: cfg.values.store_passwd, format: "json" })}`);
    const j = (await r.json()) as { status?: string; tran_id?: string; amount?: string; currency_type?: string; bank_tran_id?: string };
    const ok = (j.status === "VALID" || j.status === "VALIDATED") && j.tran_id === ctx.paymentId && Number(j.amount ?? 0) + 0.01 >= ctx.amount;
    return { ok, status: ok ? "paid" : "invalid", txnId: j.bank_tran_id ?? valId, amount: Number(j.amount ?? 0), currency: j.currency_type ?? ctx.currency, raw: j };
  },
};
