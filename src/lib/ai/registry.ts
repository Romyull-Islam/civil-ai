/**
 * Provider / model catalogue with free-tier notes (verified Sept 2026, see docs/02-api-and-hosting-research.md).
 * Model IDs rotate; the Settings page can fetch live lists via /api/models and any custom model id can be typed.
 */
export type ProviderKind = "anthropic" | "gemini" | "openai";

export interface ModelInfo { id: string; label: string; free?: boolean; vision?: boolean; note?: string }
export interface ProviderInfo {
  id: string;
  label: string;
  kind: ProviderKind;
  keyEnv: string;
  keyUrl: string;
  baseUrl?: string;
  baseUrlEnv?: string;
  models: ModelInfo[];
  freeTier: string;
  requiresKey: boolean;
  /** some OpenAI-compatible endpoints reject tools + stream together (e.g. Alibaba Model Studio) */
  streamWithTools?: boolean;
}

export const PROVIDERS: ProviderInfo[] = [
  { id: "gemini", label: "Google Gemini", kind: "gemini", keyEnv: "GEMINI_API_KEY", keyUrl: "https://aistudio.google.com/apikey", freeTier: "Free forever tier (Flash-Lite ≈ 500 req/day, Flash ≈ 20 req/day). Prompts may be used to improve Google products.", requiresKey: true,
    models: [
      { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite", free: true, vision: true, note: "~500 req/day free, 1M context, PDF/image input" },
      { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", free: true, vision: true, note: "~20 req/day free; strongest free Gemini" },
      { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite", free: true, vision: true },
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", vision: true, note: "paid $0.30/$2.50 per 1M" },
    ] },
  { id: "groq", label: "Groq", kind: "openai", keyEnv: "GROQ_API_KEY", keyUrl: "https://console.groq.com/keys", baseUrl: "https://api.groq.com/openai/v1", freeTier: "Free tier: 30 req/min, 1,000 req/day, 200K tokens/day. Very fast.", requiresKey: true,
    models: [
      { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B", free: true, note: "best free reasoning + tools" },
      { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B", free: true },
      { id: "qwen/qwen3.8-27b", label: "Qwen 3.8 27B (vision)", free: true, vision: true },
    ] },
  { id: "openrouter", label: "OpenRouter", kind: "openai", keyEnv: "OPENROUTER_API_KEY", keyUrl: "https://openrouter.ai/settings/keys", baseUrl: "https://openrouter.ai/api/v1", freeTier: "':free' models: 20 req/min, 50 req/day (1,000/day after a one-time $10 top-up). List rotates weekly.", requiresKey: true,
    models: [
      { id: "nvidia/nemotron-3.5-lightning:free", label: "Nemotron 3.5 Lightning (free)", free: true, note: "1M context" },
      { id: "nex-agi/nex-n2.5-pro:free", label: "Nex N2.5 Pro (free, vision)", free: true, vision: true },
      { id: "inclusionai/ling-3.0-flash-vl:free", label: "Ling 3.0 Flash VL (free, vision)", free: true, vision: true },
    ] },
  { id: "cerebras", label: "Cerebras", kind: "openai", keyEnv: "CEREBRAS_API_KEY", keyUrl: "https://cloud.cerebras.ai", baseUrl: "https://api.cerebras.ai/v1", freeTier: "$5 trial credit for 30 days, 5 req/min. Extremely fast.", requiresKey: true,
    models: [{ id: "gpt-oss-120b", label: "GPT-OSS 120B", free: true }, { id: "qwen-3.8-27b", label: "Qwen 3.8 27B", free: true, vision: true }] },
  { id: "mistral", label: "Mistral", kind: "openai", keyEnv: "MISTRAL_API_KEY", keyUrl: "https://console.mistral.ai/api-keys", baseUrl: "https://api.mistral.ai/v1", freeTier: "Experiment (free) tier, rate-limited.", requiresKey: true,
    models: [{ id: "mistral-small-latest", label: "Mistral Small", free: true, vision: true }, { id: "mistral-medium-latest", label: "Mistral Medium", vision: true }] },
  { id: "qwen", label: "Alibaba Qwen (Model Studio)", kind: "openai", keyEnv: "DASHSCOPE_API_KEY", baseUrlEnv: "DASHSCOPE_BASE_URL", keyUrl: "https://modelstudio.console.alibabacloud.com/ap-southeast-1/settings/api-key", baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", streamWithTools: false, freeTier: "New users: 1,000,000 free tokens per model for 90 days (international/Singapore account). Turn on 'Free quota only' in the console to avoid charges. If the console shows a workspace endpoint (https://<WorkspaceId>.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1) paste it as Base URL. China-region keys: https://dashscope.aliyuncs.com/compatible-mode/v1.", requiresKey: true,
    models: [
      { id: "qwen3.6-plus", label: "Qwen 3.6 Plus", free: true, vision: true, note: "strong reasoning + tools; 1M free tokens" },
      { id: "qwen-plus", label: "Qwen Plus", free: true, note: "1M free tokens" },
      { id: "qwen-flash", label: "Qwen Flash", free: true, note: "fastest/cheapest" },
      { id: "qwen3-max", label: "Qwen 3 Max", free: true, note: "flagship; 1M free tokens" },
    ] },
  { id: "zhipu", label: "Zhipu GLM (Z.ai)", kind: "openai", keyEnv: "ZHIPU_API_KEY", baseUrlEnv: "ZHIPU_BASE_URL", keyUrl: "https://z.ai/manage-apikey/apikey-list", baseUrl: "https://api.z.ai/api/paas/v4", freeTier: "GLM Flash models are permanently free (no card). International portal z.ai is email-only; the China portal open.bigmodel.cn needs a Chinese phone and base URL https://open.bigmodel.cn/api/paas/v4.", requiresKey: true,
    models: [
      { id: "glm-4.7-flash", label: "GLM 4.7 Flash (free)", free: true, note: "200K context, tools" },
      { id: "glm-4.5-flash", label: "GLM 4.5 Flash (free)", free: true },
      { id: "glm-4.6v-flash", label: "GLM 4.6V Flash (free, vision)", free: true, vision: true },
    ] },
  { id: "siliconflow", label: "SiliconFlow", kind: "openai", keyEnv: "SILICONFLOW_API_KEY", baseUrlEnv: "SILICONFLOW_BASE_URL", keyUrl: "https://cloud.siliconflow.com/account/ak", baseUrl: "https://api.siliconflow.com/v1", freeTier: "Some models permanently free (Qwen3-8B, DeepSeek-R1-Distill-7B) plus ~$1 signup credit; China platform (.cn) gives ¥14 credit. Free list rotates, check the console.", requiresKey: true,
    models: [
      { id: "Qwen/Qwen3-8B", label: "Qwen3 8B (free)", free: true },
      { id: "deepseek-ai/DeepSeek-V3.2", label: "DeepSeek V3.2 (paid, cheap)" },
      { id: "Qwen/Qwen3-235B-A22B-Instruct-2507", label: "Qwen3 235B (paid, cheap)" },
    ] },
  { id: "deepseek", label: "DeepSeek", kind: "openai", keyEnv: "DEEPSEEK_API_KEY", keyUrl: "https://platform.deepseek.com/api_keys", baseUrl: "https://api.deepseek.com/v1", freeTier: "No free tier; ~$0.15/$0.60 per 1M tokens off-peak.", requiresKey: true,
    models: [{ id: "deepseek-chat", label: "DeepSeek Chat" }, { id: "deepseek-reasoner", label: "DeepSeek Reasoner" }] },
  { id: "openai", label: "OpenAI", kind: "openai", keyEnv: "OPENAI_API_KEY", keyUrl: "https://platform.openai.com/api-keys", freeTier: "No free tier; gpt-5-nano $0.05/$0.40 per 1M.", requiresKey: true,
    models: [{ id: "gpt-5-nano", label: "GPT-5 nano", vision: true }, { id: "gpt-5-mini", label: "GPT-5 mini", vision: true }] },
  { id: "cloudflare", label: "Cloudflare Workers AI", kind: "openai", keyEnv: "CLOUDFLARE_API_TOKEN", baseUrlEnv: "CLOUDFLARE_AI_BASE_URL", keyUrl: "https://dash.cloudflare.com/?to=/:account/ai/workers-ai", freeTier: "10,000 Neurons/day free. Set base URL to https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/v1", requiresKey: true,
    models: [{ id: "@cf/openai/gpt-oss-120b", label: "GPT-OSS 120B", free: true }, { id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", label: "Llama 3.3 70B", free: true }] },
  { id: "local", label: "Built-in local model (offline, unlimited)", kind: "openai", keyEnv: "CIVIL_AI_LOCAL_KEY", baseUrlEnv: "CIVIL_AI_LOCAL_BASE_URL", keyUrl: "/settings#local", baseUrl: `http://127.0.0.1:${process.env.CIVIL_AI_LOCAL_PORT ?? 8765}/v1`, freeTier: "Downloaded once by the app (llama.cpp + Qwen 3.5). No API key, no quota, works offline. Set it up in Settings → Local AI.", requiresKey: false,
    models: [{ id: "qwen3.5-4b", label: "Qwen 3.5 4B (default)", free: true, vision: true }, { id: "qwen3.5-2b", label: "Qwen 3.5 2B", free: true }, { id: "qwen3.5-0.8b", label: "Qwen 3.5 0.8B", free: true }, { id: "gemma4-e2b", label: "Gemma 4 E2B", free: true, vision: true }, { id: "qwen3.5-9b", label: "Qwen 3.5 9B (advanced)", free: true, vision: true }, { id: "qwen3.5-35b-a3b", label: "Qwen 3.5 35B-A3B (advanced)", free: true, vision: true }] },
  { id: "ollama", label: "Ollama (local, offline)", kind: "openai", keyEnv: "OLLAMA_API_KEY", baseUrlEnv: "OLLAMA_BASE_URL", keyUrl: "https://ollama.com/download", baseUrl: "http://localhost:11434/v1", freeTier: "Free and offline. Install Ollama and run e.g. `ollama pull qwen3.5:4b`.", requiresKey: false,
    models: [{ id: "qwen3.5:4b", label: "Qwen 3.5 4B", free: true, vision: true }, { id: "qwen3.5:9b", label: "Qwen 3.5 9B", free: true, vision: true }, { id: "gemma4:e4b", label: "Gemma 4 E4B", free: true, vision: true }, { id: "phi4-mini", label: "Phi-4 mini", free: true }] },
  { id: "anthropic", label: "Anthropic Claude", kind: "anthropic", keyEnv: "ANTHROPIC_API_KEY", keyUrl: "https://platform.claude.com", freeTier: "Small trial credit on signup; then Haiku 4.5 $1/$5, Sonnet 5 $2/$10, Opus 5 $5/$25 per 1M tokens. Best quality for design checks.", requiresKey: true,
    models: [{ id: "claude-opus-5", label: "Claude Opus 5", vision: true, note: "highest quality" }, { id: "claude-sonnet-5", label: "Claude Sonnet 5", vision: true }, { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", vision: true, note: "lowest cost" }] },
];

export const PROVIDER_MAP = new Map(PROVIDERS.map((p) => [p.id, p]));

/** Default order for "auto" mode: free tiers first, paid last. */
/** Default order for "auto" mode: free cloud tiers first (better quality), then the unlimited local model, then paid. */
export const AUTO_CHAIN = ["gemini", "groq", "qwen", "zhipu", "openrouter", "cerebras", "mistral", "siliconflow", "cloudflare", "local", "ollama", "anthropic", "openai", "deepseek"];
/** "Offline first" order: local model before any cloud provider. */
export const LOCAL_FIRST_CHAIN = ["local", "ollama", ...AUTO_CHAIN.filter((p) => p !== "local" && p !== "ollama")];

export interface ProviderSettings { apiKey?: string; baseUrl?: string; model?: string }
export type KeyBag = Record<string, ProviderSettings>;

/** Resolve credentials: per-request settings (from the user's Settings page) override server env vars. */
export function resolveProvider(id: string, bag: KeyBag): { info: ProviderInfo; apiKey: string; baseUrl?: string } | null {
  const info = PROVIDER_MAP.get(id);
  if (!info) return null;
  const s = bag[id] ?? {};
  const apiKey = s.apiKey?.trim() || process.env[info.keyEnv] || (info.requiresKey ? "" : "ollama");
  const baseUrl = s.baseUrl?.trim() || (info.baseUrlEnv ? process.env[info.baseUrlEnv] : undefined) || info.baseUrl;
  if (info.requiresKey && !apiKey) return null;
  return { info, apiKey, baseUrl };
}
