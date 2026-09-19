/**
 * AI credits: every plan gets a monthly and a daily credit budget, and each model call is charged by the tokens it
 * actually used at that model's price. One credit = CREDIT_USD of provider cost, so a plan's worst-case AI bill is
 * known in advance (monthlyCredits × CREDIT_USD) no matter which models a user picks or how long their chats get.
 */

/** Provider cost covered by one credit (US$). $0.002 ≈ ৳0.24 ≈ one short question on the cheapest model. */
export const CREDIT_USD = 0.002;
/** Approximate exchange rate, used only to show admins costs in taka (Sept 2026). */
export const USD_TO_BDT = 122;
/** Smallest charge per model call, so free-tier-priced models still count against the plan. */
export const MIN_CREDITS_PER_CALL = 0.1;
/** Unknown models are charged at this conservative price until an admin adds the real one. */
export const DEFAULT_PRICE = { in: 3, out: 15 };

/**
 * US$ per 1M tokens (input, output), paid tier. Verified 2026-09-18 from ai.google.dev/gemini-api/docs/pricing,
 * console.groq.com/docs/models, DeepSeek's pricing page and Anthropic's model table. Local/offline models cost nothing.
 */
export const MODEL_PRICES: Record<string, { in: number; out: number }> = {
  "gemini/gemini-3.5-flash-lite": { in: 0.3, out: 2.5 },
  "gemini/gemini-3.8-flash": { in: 0.75, out: 3.75 }, // rises on 2027-01-01
  "gemini/gemini-3.1-flash-lite": { in: 0.25, out: 1.5 },
  "gemini/gemini-2.5-flash": { in: 0.3, out: 2.5 },
  "groq/openai/gpt-oss-20b": { in: 0.075, out: 0.3 },
  "groq/openai/gpt-oss-120b": { in: 0.15, out: 0.6 },
  "groq/qwen/qwen3.8-27b": { in: 0.8, out: 4 },
  // DeepSeek charges double 01:00-04:00 and 06:00-10:00 UTC on weekdays; we meter at the peak price (api-docs.deepseek.com).
  "deepseek/deepseek-flash": { in: 0.3, out: 1.2 },
  "deepseek/deepseek-v4-pro": { in: 1.32, out: 3.96 },
  "anthropic/claude-haiku-4-5": { in: 1, out: 5 },
  "anthropic/claude-sonnet-5": { in: 2, out: 10 },
  "anthropic/claude-opus-5": { in: 5, out: 25 },
};
const FREE_PROVIDERS = new Set(["local", "ollama"]);

export function modelPrice(provider: string, model: string): { in: number; out: number; known: boolean } {
  if (FREE_PROVIDERS.has(provider)) return { in: 0, out: 0, known: true };
  const p = MODEL_PRICES[`${provider}/${model}`];
  return p ? { ...p, known: true } : { ...DEFAULT_PRICE, known: false };
}

/** Credits charged for one model call. */
export function creditsFor(provider: string, model: string, inputTokens: number, outputTokens: number): number {
  if (FREE_PROVIDERS.has(provider)) return 0;
  const p = modelPrice(provider, model);
  const usd = (inputTokens * p.in + outputTokens * p.out) / 1e6;
  return Math.max(MIN_CREDITS_PER_CALL, usd / CREDIT_USD);
}

/**
 * Typical credits for one engineering question, from the benchmark (docs/eval-results.json, Sept 2026):
 * about 20K input and 1K output tokens across the tool-calling steps. Used only for display ("≈ 2 credits").
 */
export const TYPICAL_QUESTION = { input: 20000, output: 1000 };
export function estimateCredits(provider: string, model: string): number {
  return creditsFor(provider, model, TYPICAL_QUESTION.input, TYPICAL_QUESTION.output);
}
