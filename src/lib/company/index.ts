/**
 * Company edition (CIVIL_AI_MODE=company): CivilMate installed on a company's own server or PC.
 *  - The company's administrator creates, disables and deletes user accounts (no public sign-up after the first,
 *    owner account).
 *  - AI answers use the company's own provider keys (Admin → AI provider keys) or a local model (Ollama).
 *  - One internal plan for every user; the admin may set per-user credit limits (0 = unlimited) and the allowed models.
 *  - No payments, ads, cloud link or third-party calls (no Gravatar). Nothing is sent to CivilMate; the only outbound
 *    traffic is to the AI providers whose keys the company configures (none with a local model).
 */
import { getDB } from "@/lib/saas/db";
import type { Plan } from "@/lib/saas/plans";
import { PROVIDERS, AUTO_CHAIN } from "@/lib/ai/registry";
import { isUsable } from "@/lib/ai/quality";

export interface CompanySettings {
  /** AI credits per user (1 credit = US$0.002 of provider cost); 0 = unlimited */
  monthlyCredits: number;
  weeklyCredits: number;
  sessionCredits: number;
  /** allowed models as "provider/model"; empty = every approved model whose provider has a key */
  models: string[];
  /** "provider/model" used for Auto; empty = first allowed */
  defaultModel: string;
  /** server backup space per user (MB) */
  storageMB: number;
}
export const DEFAULT_COMPANY: CompanySettings = { monthlyCredits: 0, weeklyCredits: 0, sessionCredits: 0, models: [], defaultModel: "", storageMB: 500 };

export async function getCompanySettings(): Promise<CompanySettings> {
  const raw = await (await getDB()).getSetting("company");
  try { return raw ? { ...DEFAULT_COMPANY, ...(JSON.parse(raw) as Partial<CompanySettings>) } : DEFAULT_COMPANY; } catch { return DEFAULT_COMPANY; }
}
export async function setCompanySettings(s: CompanySettings) {
  const n = (x: unknown) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Math.round(Number(x)) : 0);
  const clean: CompanySettings = { monthlyCredits: n(s.monthlyCredits), weeklyCredits: n(s.weeklyCredits), sessionCredits: n(s.sessionCredits), models: (s.models ?? []).filter((m) => typeof m === "string" && m.includes("/")).slice(0, 100), defaultModel: typeof s.defaultModel === "string" ? s.defaultModel : "", storageMB: n(s.storageMB) || DEFAULT_COMPANY.storageMB };
  await (await getDB()).setSetting("company", JSON.stringify(clean));
  return clean;
}

/** Providers that can answer: a key stored by the admin or in the environment, or a local model server. */
export async function configuredProviders(): Promise<Set<string>> {
  const db = await getDB();
  const out = new Set<string>();
  for (const p of PROVIDERS) {
    const key = await db.getSetting(`key:${p.id}`);
    const base = await db.getSetting(`baseurl:${p.id}`);
    // Keyless local servers (Ollama) count only once their address is set (Admin → AI provider keys, or OLLAMA_BASE_URL).
    if (key || process.env[p.keyEnv] || (!p.requiresKey && (base || (p.baseUrlEnv && process.env[p.baseUrlEnv])))) out.add(p.id);
  }
  return out;
}

/** Every model the company can use, in fallback order (the default first). */
export async function companyModels(s?: CompanySettings): Promise<{ provider: string; model: string }[]> {
  const settings = s ?? (await getCompanySettings());
  const ready = await configuredProviders();
  const order = [...new Set([...AUTO_CHAIN, ...PROVIDERS.map((p) => p.id)])];
  const all = order.flatMap((pid) => {
    const p = PROVIDERS.find((x) => x.id === pid);
    if (!p || !ready.has(pid)) return [];
    return p.models.filter((m) => isUsable(pid, m.id)).map((m) => ({ provider: pid, model: m.id }));
  });
  // Models served by the company's own server (Ollama / vLLM, e.g. a fine-tuned model) are added by name in Admin → Company.
  const custom = settings.models.map((x) => ({ provider: x.slice(0, x.indexOf("/")), model: x.slice(x.indexOf("/") + 1) })).filter((m) => ready.has(m.provider) && !PROVIDERS.find((p) => p.id === m.provider)?.requiresKey && !all.some((a) => a.provider === m.provider && a.model === m.model));
  const allowed = settings.models.length ? [...all.filter((m) => settings.models.includes(`${m.provider}/${m.model}`)), ...custom] : all;
  const def = allowed.find((m) => `${m.provider}/${m.model}` === settings.defaultModel);
  return def ? [def, ...allowed.filter((m) => m !== def)] : allowed;
}

/** The single internal plan every user of a company install is on. */
export async function companyPlan(): Promise<Plan> {
  const s = await getCompanySettings();
  const models = await companyModels(s);
  const providers: Plan["providers"] = [];
  for (const m of models) { const g = providers.find((p) => p.provider === m.provider); if (g) g.models.push(m.model); else providers.push({ provider: m.provider, models: [m.model] }); }
  const lim = (n: number) => (n > 0 ? n : Infinity);
  return {
    id: "company", name: "Company", priceMonthly: 0, currency: "USD",
    monthlyCredits: lim(s.monthlyCredits), weeklyCredits: lim(s.weeklyCredits), sessionCredits: lim(s.sessionCredits), sessionHours: 5,
    providers, features: [], vision: true, localAI: true, cloudStorageMB: s.storageMB, maxSavedItems: 5000,
  };
}
