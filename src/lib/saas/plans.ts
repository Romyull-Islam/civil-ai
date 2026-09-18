/** Subscription plans → allowed providers/models and AI credit budgets. Admins can override via the admin panel (stored in settings "plans"). */
export interface Plan {
  id: string;
  name: string;
  priceMonthly: number; // in `currency` (BDT by default)
  /** price for international card payments (Stripe), in USD */
  priceUSD?: number;
  currency: string;
  /**
   * AI credits (see credits.ts: 1 credit = US$0.002 of provider cost) per billing period and per UTC day. Each model call
   * is charged by its real token use, so the worst-case AI cost of a plan is monthlyCredits × $0.002 whatever the user picks.
   * Calculators, drawings and the code library do not use credits.
   */
  monthlyCredits: number;
  dailyCredits: number;
  /** @deprecated request counting before credits; only read to migrate plans saved by older versions */
  dailyRequests?: number;
  providers: { provider: string; models: string[] }[];
  features: string[];
  vision: boolean;
  /** desktop app may install and run the built-in offline model */
  localAI: boolean;
  /** days a manual payment activates (default 30) */
  periodDays?: number;
  /** days after expiry during which the plan keeps working while the user renews (default 3) */
  graceDays?: number;
  /** cloud backup allowance per user: MB of compressed chats/drawings (0 = none) and max items */
  cloudStorageMB?: number;
  maxSavedItems?: number;
  /** team plan: price is per seat per period; the buyer becomes the team owner and adds members */
  perSeat?: boolean;
  minSeats?: number;
}

export const DEFAULT_PLANS: Plan[] = [
  { id: "free", name: "Free", priceMonthly: 0, priceUSD: 0, currency: "BDT", monthlyCredits: 60, dailyCredits: 5, vision: false, localAI: false, cloudStorageMB: 0, maxSavedItems: 0,
    providers: [{ provider: "groq", models: ["openai/gpt-oss-20b"] }, { provider: "gemini", models: ["gemini-3.5-flash-lite"] }],
    features: ["All calculators, drawings and code library", "60 AI credits / month (about 60 quick questions)", "Standard models"] },
  { id: "pro", name: "Pro", priceMonthly: 300, priceUSD: 2.8, currency: "BDT", monthlyCredits: 500, dailyCredits: 50, vision: true, localAI: true, periodDays: 30, cloudStorageMB: 20, maxSavedItems: 300,
    providers: [{ provider: "groq", models: ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b"] }, { provider: "gemini", models: ["gemini-3.5-flash-lite", "gemini-3.8-flash"] }],
    features: ["500 AI credits / month (about 250 questions on the Smart model)", "Strong models (GPT-OSS 120B, Gemini 3.8 Flash, Qwen 3.8)", "Photo & drawing image analysis", "Cloud backup of chats & designs (20 MB ≈ 400 chats)", "Offline local model in the desktop app (unlimited)", "Email support"] },
  { id: "max", name: "Max", priceMonthly: 1000, priceUSD: 8, currency: "BDT", monthlyCredits: 1700, dailyCredits: 170, vision: true, localAI: true, periodDays: 30, cloudStorageMB: 50, maxSavedItems: 500,
    providers: [{ provider: "groq", models: ["openai/gpt-oss-120b", "qwen/qwen3.8-27b"] }, { provider: "gemini", models: ["gemini-3.8-flash", "gemini-3.5-flash-lite"] }, { provider: "anthropic", models: ["claude-haiku-4-5", "claude-sonnet-5"] }],
    features: ["1,700 AI credits / month", "Premium models incl. Claude Sonnet 5", "Cloud backup of chats & designs (50 MB ≈ 1,000 chats)", "Offline local model in the desktop app (unlimited)", "Priority support"] },
  { id: "team", name: "Team / Enterprise", priceMonthly: 800, priceUSD: 6.5, currency: "BDT", monthlyCredits: 1200, dailyCredits: 120, vision: true, localAI: true, periodDays: 30, graceDays: 5, perSeat: true, minSeats: 3, cloudStorageMB: 50, maxSavedItems: 500,
    providers: [{ provider: "groq", models: ["openai/gpt-oss-120b", "qwen/qwen3.8-27b"] }, { provider: "gemini", models: ["gemini-3.8-flash", "gemini-3.5-flash-lite"] }, { provider: "anthropic", models: ["claude-haiku-4-5", "claude-sonnet-5"] }],
    features: ["1,200 AI credits / month for every team member", "৳800 per user / month (min 3 users)", "Owner adds and removes members", "One invoice for the whole team", "Priority support"] },
];

/** Plans saved by versions before credits have only dailyRequests: take the default plan's budgets, else derive them. */
export function withCreditDefaults(p: Plan): Plan {
  if (typeof p.monthlyCredits === "number" && typeof p.dailyCredits === "number") return p;
  const d = DEFAULT_PLANS.find((x) => x.id === p.id);
  const daily = d?.dailyCredits ?? Math.max(5, Math.round((p.dailyRequests ?? 20) * 2));
  return { ...p, dailyCredits: p.dailyCredits ?? daily, monthlyCredits: p.monthlyCredits ?? d?.monthlyCredits ?? daily * 10 };
}

export function planModels(p: Plan): { provider: string; model: string }[] {
  return p.providers.flatMap((x) => x.models.map((m) => ({ provider: x.provider, model: m })));
}
