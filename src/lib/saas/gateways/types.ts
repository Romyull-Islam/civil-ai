export interface GatewayField { key: string; label: string; secret?: boolean; placeholder?: string }
export interface GatewayConfig { enabled: boolean; sandbox: boolean; values: Record<string, string> }
export interface CheckoutContext {
  paymentId: string; // our unique order/transaction id, sent to the gateway
  amount: number; // in `currency`
  currency: string;
  plan: { id: string; name: string };
  user: { email: string; name: string; phone?: string };
  baseUrl: string; // public URL of this app (for return/IPN URLs)
}
export interface VerifyResult { ok: boolean; txnId?: string; amount?: number; currency?: string; status: "paid" | "failed" | "cancelled" | "pending" | "invalid"; raw?: unknown }

export interface Gateway {
  id: string;
  label: string;
  /** what the customer can pay with on the hosted page */
  methods: string;
  fields: GatewayField[];
  docs: string;
  createCheckout(cfg: GatewayConfig, ctx: CheckoutContext): Promise<{ url: string; providerRef?: string }>;
  /** Verify the outcome using the parameters the gateway sent back (query/body) and/or a server-to-server lookup. */
  verify(cfg: GatewayConfig, params: Record<string, string>, ctx: CheckoutContext): Promise<VerifyResult>;
}

export const returnUrl = (ctx: CheckoutContext, gateway: string, kind: "success" | "fail" | "cancel") => `${ctx.baseUrl}/api/checkout/return/${gateway}?pid=${encodeURIComponent(ctx.paymentId)}&outcome=${kind}`;
export const form = (o: Record<string, string | number | undefined>) => new URLSearchParams(Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]))).toString();
