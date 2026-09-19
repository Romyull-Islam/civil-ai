/**
 * Quality gate: which models are good enough for civil, construction and architectural work, from our benchmark
 * (scripts/eval.mjs: 21 engineering questions with hand-checked answers; a pass needs the right tool result, the key
 * figures stated in the answer and no invented numbers). Paid credits are only spent on models that are not rejected.
 *
 * approved    ≥ 90% of the benchmark answered fully correctly
 * provisional not measured fairly yet (free-tier limits or no key); usable, shown with a warning to admins
 * rejected    produced wrong engineering answers; never used, even if ticked in a plan
 */
export type QualityStatus = "approved" | "provisional" | "rejected";
export interface ModelQuality { status: QualityStatus; evidence: string; date: string }

export const QUALITY_PASS_RATE = 0.9;

export const MODEL_QUALITY: Record<string, ModelQuality> = {
  "gemini/gemini-3.5-flash-lite": { status: "provisional", date: "2026-09-18", evidence: "12 of 16 correct; every miss was a free-tier rate limit, none a wrong answer" },
  "gemini/gemini-3.1-flash-lite": { status: "provisional", date: "2026-09-18", evidence: "6 of 15 correct; 7 misses were Google overload errors, 1 empty reply, 1 answer kept an unverified figure" },
  "groq/qwen/qwen3.8-27b": { status: "provisional", date: "2026-09-18", evidence: "of 11 answered, 8 correct and 3 kept figures no tool produced (below the 90% bar); 10 more hit free-tier limits. Removed from plans until retested" },
  "groq/openai/gpt-oss-120b": { status: "provisional", date: "2026-09-18", evidence: "not measured yet: free daily token quota used up" },
  "gemini/gemini-3.8-flash": { status: "provisional", date: "2026-09-18", evidence: "not measured yet: Google overload during the test" },
  "groq/openai/gpt-oss-20b": { status: "rejected", date: "2026-09-18", evidence: "invented its own working in a live answer (15.5 kg cement bags, wrong ratio) and returned empty replies" },
};

export function modelQuality(provider: string, model: string): ModelQuality {
  if (provider === "local" || provider === "ollama") return { status: "approved", date: "2026-09-17", evidence: "offline model, 11 of 11 on the original benchmark (unlimited, no credits)" };
  return MODEL_QUALITY[`${provider}/${model}`] ?? { status: "provisional", date: "", evidence: "not benchmarked yet" };
}

export const isUsable = (provider: string, model: string) => modelQuality(provider, model).status !== "rejected";
