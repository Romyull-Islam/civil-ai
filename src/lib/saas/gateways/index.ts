import { getDB } from "../db";
import { encrypt, decrypt } from "../crypto";
import { sslcommerz } from "./sslcommerz";
import { bkash } from "./bkash";
import { aamarpay } from "./aamarpay";
import { shurjopay } from "./shurjopay";
import { stripe } from "./stripe";
import type { Gateway, GatewayConfig } from "./types";
export type { Gateway, GatewayConfig, CheckoutContext, VerifyResult } from "./types";

export const GATEWAYS: Gateway[] = [sslcommerz, aamarpay, shurjopay, bkash, stripe];
export const gatewayById = (id: string) => GATEWAYS.find((g) => g.id === id);

const EMPTY: GatewayConfig = { enabled: false, sandbox: true, values: {} };

/** Env fallback so a gateway can be configured at deploy time: GATEWAY_SSLCOMMERZ_STORE_ID, GATEWAY_SSLCOMMERZ_STORE_PASSWD, GATEWAY_SSLCOMMERZ_LIVE=1 (etc. for other gateways). */
function envConfig(id: string): GatewayConfig | null {
  const g = gatewayById(id);
  if (!g) return null;
  const prefix = `GATEWAY_${id.toUpperCase()}_`;
  const values: Record<string, string> = {};
  for (const f of g.fields) { const v = process.env[prefix + f.key.toUpperCase()]; if (v) values[f.key] = v; }
  const required = g.fields.filter((f) => !/optional/i.test(f.label));
  if (!required.every((f) => values[f.key])) return null;
  return { enabled: true, sandbox: process.env[prefix + "LIVE"] !== "1", values };
}

export async function getGatewayConfig(id: string): Promise<GatewayConfig> {
  const raw = await (await getDB()).getSetting(`gateway:${id}`);
  if (!raw) return envConfig(id) ?? EMPTY;
  try { return { ...EMPTY, ...(JSON.parse(decrypt(raw)) as GatewayConfig) }; } catch { return envConfig(id) ?? EMPTY; }
}
export async function setGatewayConfig(id: string, cfg: GatewayConfig) {
  await (await getDB()).setSetting(`gateway:${id}`, encrypt(JSON.stringify(cfg)));
}
/**
 * Gateways ready for checkout (enabled and every non-optional field filled). Test-mode gateways are offered only to
 * staff (`includeSandbox`): otherwise a customer could "pay" with a sandbox test card and get a plan for free.
 */
export async function enabledGateways(includeSandbox = false): Promise<{ id: string; label: string; methods: string; sandbox: boolean }[]> {
  const out = [];
  for (const g of GATEWAYS) {
    const c = await getGatewayConfig(g.id);
    const required = g.fields.filter((f) => !/optional/i.test(f.label));
    if (c.enabled && required.every((f) => c.values[f.key]?.trim()) && (includeSandbox || !c.sandbox)) out.push({ id: g.id, label: g.label, methods: g.methods, sandbox: c.sandbox });
  }
  return out;
}
/** Admin view: config with secrets masked. */
export async function gatewayStatus() {
  const out = [];
  for (const g of GATEWAYS) {
    const c = await getGatewayConfig(g.id);
    const required = g.fields.filter((f) => !/optional/i.test(f.label));
    const complete = required.every((f) => c.values[f.key]?.trim());
    out.push({ id: g.id, label: g.label, methods: g.methods, docs: g.docs, fields: g.fields, hasSandboxValues: !!g.sandboxValues, state: !complete ? "not set up" : !c.enabled ? "off" : c.sandbox ? "test mode" : "live", enabled: c.enabled, sandbox: c.sandbox, fromEnv: !!envConfig(g.id) && !(await (await getDB()).getSetting(`gateway:${g.id}`)), values: Object.fromEntries(g.fields.map((f) => [f.key, f.secret ? (c.values[f.key] ? "••••••••" : "") : c.values[f.key] ?? ""])) });
  }
  return out;
}

/** Try to open a checkout session with the saved credentials (nothing is charged or recorded). */
export async function testGateway(id: string, baseUrl: string): Promise<{ ok: boolean; message: string }> {
  const g = gatewayById(id);
  if (!g) return { ok: false, message: "Unknown gateway" };
  const cfg = await getGatewayConfig(id);
  try {
    await g.createCheckout(cfg, { paymentId: `TEST${Date.now().toString(36).toUpperCase()}`, amount: id === "stripe" ? 1 : 10, currency: id === "stripe" ? "USD" : "BDT", plan: { id: "test", name: "Connection test" }, user: { email: "test@example.com", name: "Connection test" }, baseUrl });
    return { ok: true, message: `Connected: ${g.label} accepted the credentials${cfg.sandbox ? " (test mode)" : ""}. Nothing was charged.` };
  } catch (e) { return { ok: false, message: e instanceof Error ? e.message : String(e) }; }
}
