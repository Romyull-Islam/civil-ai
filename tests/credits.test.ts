import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { creditsFor, estimateCredits, CREDIT_USD, USD_TO_BDT, MIN_CREDITS_PER_CALL } from "@/lib/saas/credits";
import { DEFAULT_PLANS, withCreditDefaults, type Plan } from "@/lib/saas/plans";

describe("credit pricing", () => {
  it("charges each model by its real price per typical question", () => {
    expect(estimateCredits("groq", "openai/gpt-oss-20b")).toBeCloseTo(0.9, 1);
    expect(estimateCredits("groq", "openai/gpt-oss-120b")).toBeCloseTo(1.8, 1);
    expect(estimateCredits("gemini", "gemini-3.5-flash-lite")).toBeCloseTo(4.25, 2);
    expect(estimateCredits("gemini", "gemini-3.8-flash")).toBeCloseTo(9.375, 3);
  });
  it("charges unknown models conservatively, local models nothing, and at least the minimum otherwise", () => {
    expect(estimateCredits("mistral", "mistral-small-latest")).toBeCloseTo(37.5, 1);
    expect(creditsFor("local", "qwen3.5-4b", 50000, 5000)).toBe(0);
    expect(creditsFor("groq", "openai/gpt-oss-20b", 10, 10)).toBe(MIN_CREDITS_PER_CALL);
  });
  it("no default paid plan can cost more in AI than 45% of its price, even at 100% use", () => {
    for (const p of DEFAULT_PLANS.filter((x) => x.priceMonthly > 0)) {
      const worstBDT = p.monthlyCredits * CREDIT_USD * USD_TO_BDT;
      expect(worstBDT / p.priceMonthly, p.id).toBeLessThanOrEqual(0.45);
    }
  });
  it("plans saved before credits get budgets", () => {
    const legacy = { ...DEFAULT_PLANS[1], monthlyCredits: undefined, dailyCredits: undefined, dailyRequests: 100 } as unknown as Plan;
    expect(withCreditDefaults(legacy)).toMatchObject({ monthlyCredits: 500, dailyCredits: 50 });
    const custom = { ...legacy, id: "gold" } as Plan;
    expect(withCreditDefaults(custom)).toMatchObject({ dailyCredits: 200, monthlyCredits: 2000 });
  });
});

describe("quota against a real database", () => {
  beforeAll(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "civilmate-credits-"));
    process.env.DATABASE_PATH = path.join(dir, "test.sqlite");
    delete process.env.DATABASE_URL;
  });

  it("period starts: calendar month for free, expiry minus period for paid", async () => {
    const { periodStartDay } = await import("@/lib/saas/service");
    const now = Date.parse("2026-09-18T12:00:00Z");
    expect(periodStartDay(DEFAULT_PLANS[0], null, now)).toBe("2026-09-01");
    expect(periodStartDay(DEFAULT_PLANS[1], Date.parse("2026-09-28T12:00:00Z"), now)).toBe("2026-08-29");
  });

  it("charges calls, enforces the daily allowance and counts one question per request", async () => {
    const { getDB } = await import("@/lib/saas/db");
    const { quota, recordUsage } = await import("@/lib/saas/service");
    const db = await getDB();
    const user = { id: "u-credits", email: "credits@test.local", name: "", passwordHash: "x", role: "user" as const, plan: "free", planExpires: null, createdAt: Date.now(), disabled: 0, emailVerified: 1, verifyCode: null, verifyExpires: null };
    await db.createUser(user);
    let q = await quota(user);
    expect(q).toMatchObject({ used: 0, limit: 5, periodLimit: 60, remaining: 5 });
    // one question on Gemini 3.5 Flash-Lite in two model calls (tool call + answer) ≈ 4.25 credits
    await recordUsage(user.id, "gemini", "gemini-3.5-flash-lite", 10000, 500, true);
    await recordUsage(user.id, "gemini", "gemini-3.5-flash-lite", 10000, 500, false);
    q = await quota(user);
    expect(q.used).toBeCloseTo(4.25, 2);
    expect(q.remaining).toBeCloseTo(0.75, 2);
    expect((await db.getUsage(user.id, new Date().toISOString().slice(0, 10))).requests).toBe(1);
    await recordUsage(user.id, "gemini", "gemini-3.5-flash-lite", 10000, 500, true);
    expect((await quota(user)).remaining).toBe(0);
  });
});
