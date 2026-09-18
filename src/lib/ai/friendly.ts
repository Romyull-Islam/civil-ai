/** Plain-language names for models, shown to users and admins instead of raw model ids. */
export type Tier = "fast" | "smart" | "best";
export interface FriendlyModel { name: string; tier: Tier; blurb: string; vision?: boolean }

const MAP: Record<string, FriendlyModel> = {
  "gemini/gemini-3.5-flash-lite": { name: "Gemini Flash-Lite", tier: "fast", blurb: "Quick answers, calculators and quantities", vision: true },
  "gemini/gemini-3.1-flash-lite": { name: "Gemini 3.1 Flash-Lite", tier: "fast", blurb: "Quick answers and calculators", vision: true },
  "gemini/gemini-3.8-flash": { name: "Gemini 3.8 Flash", tier: "smart", blurb: "Good reasoning; reads site photos and drawings", vision: true },
  "gemini/gemini-2.5-flash": { name: "Gemini 2.5 Flash", tier: "smart", blurb: "Balanced reasoning and speed", vision: true },
  "groq/openai/gpt-oss-20b": { name: "GPT-OSS 20B", tier: "fast", blurb: "Very fast; everyday calculations" },
  "groq/openai/gpt-oss-120b": { name: "GPT-OSS 120B", tier: "smart", blurb: "Strong engineering reasoning and tool use" },
  "groq/qwen/qwen3.8-27b": { name: "Qwen 3.8 Vision", tier: "smart", blurb: "Reads site photos, drawings and tables", vision: true },
  "qwen/qwen-flash": { name: "Qwen Flash", tier: "fast", blurb: "Fast and economical" },
  "qwen/qwen-plus": { name: "Qwen Plus", tier: "smart", blurb: "Balanced quality and speed" },
  "qwen/qwen3.6-plus": { name: "Qwen 3.6 Plus", tier: "smart", blurb: "Strong on tables, codes and long answers", vision: true },
  "qwen/qwen3-max": { name: "Qwen 3 Max", tier: "best", blurb: "Top-tier reasoning for complex designs" },
  "zhipu/glm-4.7-flash": { name: "GLM 4.7 Flash", tier: "fast", blurb: "Fast general answers" },
  "zhipu/glm-4.6v-flash": { name: "GLM 4.6 Vision", tier: "fast", blurb: "Reads images quickly", vision: true },
  "openrouter/nvidia/nemotron-3.5-lightning:free": { name: "Nemotron Lightning", tier: "fast", blurb: "Fast, long context" },
  "anthropic/claude-haiku-4-5": { name: "Claude Haiku", tier: "smart", blurb: "Careful explanations; reads drawings", vision: true },
  "anthropic/claude-sonnet-5": { name: "Claude Sonnet", tier: "best", blurb: "Highest quality for complex design questions", vision: true },
  "anthropic/claude-opus-5": { name: "Claude Opus", tier: "best", blurb: "Most capable; deep multi-step design work", vision: true },
  "openai/gpt-5-nano": { name: "GPT-5 nano", tier: "fast", blurb: "Fast and economical", vision: true },
  "openai/gpt-5-mini": { name: "GPT-5 mini", tier: "smart", blurb: "Balanced reasoning", vision: true },
  "deepseek/deepseek-chat": { name: "DeepSeek", tier: "smart", blurb: "Economical strong reasoning" },
  "deepseek/deepseek-reasoner": { name: "DeepSeek Reasoner", tier: "best", blurb: "Deliberate step-by-step reasoning" },
  "local/qwen3.5-4b": { name: "Offline model (Qwen 3.5 4B)", tier: "fast", blurb: "Runs on this PC, no internet, unlimited", vision: true },
};

export function friendlyModel(provider: string, model: string, fallbackLabel?: string): FriendlyModel {
  return MAP[`${provider}/${model}`] ?? { name: fallbackLabel ?? model, tier: /max|opus|sonnet|pro/i.test(model) ? "best" : /lite|flash|nano|mini|20b|8b|4b/i.test(model) ? "fast" : "smart", blurb: "" };
}
export const TIER_LABEL: Record<Tier, string> = { fast: "Fast", smart: "Smart", best: "Best" };
