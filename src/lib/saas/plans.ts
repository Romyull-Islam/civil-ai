/** Subscription plans → allowed providers/models and daily quotas. Admins can override via the admin panel (stored in settings "plans"). */
export interface Plan {
  id: string;
  name: string;
  priceMonthly: number; // in `currency` (BDT by default)
  /** price for international card payments (Stripe), in USD */
  priceUSD?: number;
  currency: string;
  dailyRequests: number; // AI chat requests per UTC day (calculators/drawings pages are unlimited)
  providers: { provider: string; models: string[] }[];
  features: string[];
  vision: boolean;
  /** desktop app may install and run the built-in offline model */
  localAI: boolean;
  /** days a manual payment activates (default 30) */
  periodDays?: number;
  /** days after expiry during which the plan keeps working while the user renews (default 3) */
  graceDays?: number;
  /** team plan: price is per seat per period; the buyer becomes the team owner and adds members */
  perSeat?: boolean;
  minSeats?: number;
}

export const DEFAULT_PLANS: Plan[] = [
  { id: "free", name: "Free", priceMonthly: 0, priceUSD: 0, currency: "BDT", dailyRequests: 15, vision: false, localAI: false,
    providers: [{ provider: "gemini", models: ["gemini-3.5-flash-lite"] }, { provider: "groq", models: ["openai/gpt-oss-20b"] }],
    features: ["All calculators, drawings and code library", "15 AI requests / day", "Standard models"] },
  { id: "pro", name: "Pro", priceMonthly: 300, priceUSD: 2.8, currency: "BDT", dailyRequests: 100, vision: true, localAI: true, periodDays: 30,
    providers: [{ provider: "groq", models: ["openai/gpt-oss-120b", "qwen/qwen3.6-27b"] }, { provider: "gemini", models: ["gemini-3.8-flash", "gemini-3.5-flash-lite"] }, { provider: "qwen", models: ["qwen3.6-plus"] }, { provider: "zhipu", models: ["glm-4.7-flash"] }],
    features: ["100 AI requests / day", "Strong models (GPT-OSS 120B, Gemini 3.8 Flash, Qwen 3.6 Plus)", "Photo & drawing image analysis", "Offline local model in the desktop app", "Email support"] },
  { id: "max", name: "Max", priceMonthly: 1000, priceUSD: 8, currency: "BDT", dailyRequests: 300, vision: true, localAI: true, periodDays: 30,
    providers: [{ provider: "groq", models: ["openai/gpt-oss-120b", "qwen/qwen3.6-27b"] }, { provider: "gemini", models: ["gemini-3.8-flash"] }, { provider: "qwen", models: ["qwen3.6-plus", "qwen3-max"] }, { provider: "anthropic", models: ["claude-haiku-4-5", "claude-sonnet-5"] }, { provider: "openai", models: ["gpt-5-mini"] }],
    features: ["300 AI requests / day", "Premium models incl. Claude Sonnet 5 and Qwen 3 Max", "Offline local model in the desktop app", "Priority support"] },
  { id: "team", name: "Team / Enterprise", priceMonthly: 800, priceUSD: 6.5, currency: "BDT", dailyRequests: 300, vision: true, localAI: true, periodDays: 30, graceDays: 5, perSeat: true, minSeats: 3,
    providers: [{ provider: "groq", models: ["openai/gpt-oss-120b", "qwen/qwen3.6-27b"] }, { provider: "gemini", models: ["gemini-3.8-flash"] }, { provider: "qwen", models: ["qwen3.6-plus", "qwen3-max"] }, { provider: "anthropic", models: ["claude-haiku-4-5", "claude-sonnet-5"] }, { provider: "openai", models: ["gpt-5-mini"] }],
    features: ["Everything in Max, for every team member", "৳800 per user / month (min 3 users)", "Owner adds and removes members", "One invoice for the whole team", "Priority support"] },
];

export function planModels(p: Plan): { provider: string; model: string }[] {
  return p.providers.flatMap((x) => x.models.map((m) => ({ provider: x.provider, model: m })));
}
