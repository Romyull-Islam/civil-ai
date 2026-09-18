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

export async function getGatewayConfig(id: string): Promise<GatewayConfig> {
  const raw = await (await getDB()).getSetting(`gateway:${id}`);
  if (!raw) return EMPTY;
  try { return { ...EMPTY, ...(JSON.parse(decrypt(raw)) as GatewayConfig) }; } catch { return EMPTY; }
}
export async function setGatewayConfig(id: string, cfg: GatewayConfig) {
  await (await getDB()).setSetting(`gateway:${id}`, encrypt(JSON.stringify(cfg)));
}
/** Gateways ready for customers (enabled and every non-optional field filled). */
export async function enabledGateways(): Promise<{ id: string; label: string; methods: string; sandbox: boolean }[]> {
  const out = [];
  for (const g of GATEWAYS) {
    const c = await getGatewayConfig(g.id);
    const required = g.fields.filter((f) => !/optional/i.test(f.label));
    if (c.enabled && required.every((f) => c.values[f.key]?.trim())) out.push({ id: g.id, label: g.label, methods: g.methods, sandbox: c.sandbox });
  }
  return out;
}
/** Admin view: config with secrets masked. */
export async function gatewayStatus() {
  const out = [];
  for (const g of GATEWAYS) {
    const c = await getGatewayConfig(g.id);
    out.push({ id: g.id, label: g.label, methods: g.methods, docs: g.docs, fields: g.fields, enabled: c.enabled, sandbox: c.sandbox, values: Object.fromEntries(g.fields.map((f) => [f.key, f.secret ? (c.values[f.key] ? "••••••••" : "") : c.values[f.key] ?? ""])) });
  }
  return out;
}
