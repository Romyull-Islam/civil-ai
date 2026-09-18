import { Gateway, returnUrl } from "./types";

/** bKash Tokenized Checkout (merchant account required). Docs: https://developer.bka.sh/docs/checkout-process-overview */
const base = (sandbox: boolean) => (sandbox ? "https://tokenized.sandbox.bka.sh/v1.2.0-beta" : "https://tokenized.pay.bka.sh/v1.2.0-beta");

async function grantToken(cfg: { sandbox: boolean; values: Record<string, string> }): Promise<string> {
  const r = await fetch(`${base(cfg.sandbox)}/tokenized/checkout/token/grant`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", username: cfg.values.username, password: cfg.values.password }, body: JSON.stringify({ app_key: cfg.values.app_key, app_secret: cfg.values.app_secret }) });
  const j = (await r.json()) as { id_token?: string; statusCode?: string; statusMessage?: string };
  if (!j.id_token) throw new Error(`bKash token: ${j.statusMessage ?? j.statusCode ?? r.status}`);
  return j.id_token;
}

export const bkash: Gateway = {
  id: "bkash",
  label: "bKash (merchant API)",
  methods: "bKash wallet",
  fields: [{ key: "app_key", label: "App key" }, { key: "app_secret", label: "App secret", secret: true }, { key: "username", label: "Username" }, { key: "password", label: "Password", secret: true }],
  docs: "https://developer.bka.sh/",
  async createCheckout(cfg, ctx) {
    const token = await grantToken(cfg);
    const r = await fetch(`${base(cfg.sandbox)}/tokenized/checkout/create`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: token, "X-App-Key": cfg.values.app_key }, body: JSON.stringify({ mode: "0011", payerReference: ctx.user.phone || ctx.user.email.slice(0, 30), callbackURL: returnUrl(ctx, "bkash", "success"), amount: String(Math.round(ctx.amount)), currency: "BDT", intent: "sale", merchantInvoiceNumber: ctx.paymentId }) });
    const j = (await r.json()) as { bkashURL?: string; paymentID?: string; statusCode?: string; statusMessage?: string };
    if (!j.bkashURL || !j.paymentID) throw new Error(`bKash create: ${j.statusMessage ?? j.statusCode ?? "failed"}`);
    return { url: j.bkashURL, providerRef: j.paymentID };
  },
  async verify(cfg, params, ctx) {
    const paymentID = params.paymentID;
    if (params.status === "cancel") return { ok: false, status: "cancelled" };
    if (params.status === "failure" || !paymentID) return { ok: false, status: "failed" };
    const token = await grantToken(cfg);
    const r = await fetch(`${base(cfg.sandbox)}/tokenized/checkout/execute`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: token, "X-App-Key": cfg.values.app_key }, body: JSON.stringify({ paymentID }) });
    let j = (await r.json()) as { statusCode?: string; statusMessage?: string; trxID?: string; transactionStatus?: string; amount?: string; merchantInvoiceNumber?: string };
    if (j.statusCode !== "0000" || j.transactionStatus !== "Completed") {
      // execute may time out; query status as the source of truth
      const q = await fetch(`${base(cfg.sandbox)}/tokenized/checkout/payment/status`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: token, "X-App-Key": cfg.values.app_key }, body: JSON.stringify({ paymentID }) });
      j = (await q.json()) as typeof j;
    }
    const ok = j.statusCode === "0000" && j.transactionStatus === "Completed" && (!j.merchantInvoiceNumber || j.merchantInvoiceNumber === ctx.paymentId);
    return { ok, status: ok ? "paid" : "failed", txnId: j.trxID, amount: Number(j.amount ?? ctx.amount), currency: "BDT", raw: j };
  },
};
