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
  it("plans saved by older versions get monthly, weekly and session budgets", () => {
    const legacy = { ...DEFAULT_PLANS[1], monthlyCredits: undefined, weeklyCredits: undefined, sessionCredits: undefined, dailyRequests: 100 } as unknown as Plan;
    expect(withCreditDefaults(legacy)).toMatchObject({ monthlyCredits: 500, weeklyCredits: 200, sessionCredits: 60, sessionHours: 5 });
    const daily = { ...legacy, id: "gold", dailyCredits: 100 } as unknown as Plan;
    expect(withCreditDefaults(daily)).toMatchObject({ monthlyCredits: 1000, weeklyCredits: 400, sessionCredits: 120 });
  });
  it("default plans only offer models that have not failed the engineering benchmark", async () => {
    const { isUsable } = await import("@/lib/ai/quality");
    const { planModels } = await import("@/lib/saas/plans");
    for (const p of DEFAULT_PLANS) for (const m of planModels(p)) expect(isUsable(m.provider, m.model), `${p.id}: ${m.model}`).toBe(true);
  });
  it("every default plan lets a user spend the month in a few weeks but not in one sitting", () => {
    for (const p of DEFAULT_PLANS) {
      expect(p.weeklyCredits * 4, p.id).toBeGreaterThan(p.monthlyCredits);
      expect(p.weeklyCredits, p.id).toBeLessThan(p.monthlyCredits);
      expect(p.sessionCredits, p.id).toBeLessThan(p.weeklyCredits);
    }
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

  it("windows: weeks count from the period start; sessions last 5 hours from the first question", async () => {
    const { weekWindow, periodEnd } = await import("@/lib/saas/service");
    const end = periodEnd(DEFAULT_PLANS[0], "2026-09-01", null);
    expect(new Date(end).toISOString()).toBe("2026-10-01T00:00:00.000Z");
    const w = weekWindow("2026-09-01", end, Date.parse("2026-09-18T12:00:00Z"));
    expect(new Date(w.start).toISOString().slice(0, 10)).toBe("2026-09-15");
    expect(new Date(w.end).toISOString().slice(0, 10)).toBe("2026-09-22");
    expect(new Date(weekWindow("2026-09-01", end, Date.parse("2026-09-30T12:00:00Z")).end).toISOString().slice(0, 10)).toBe("2026-10-01");
  });

  it("charges each call and enforces session, weekly and monthly limits", async () => {
    const { getDB } = await import("@/lib/saas/db");
    const { quota, recordUsage, limitMessage } = await import("@/lib/saas/service");
    const db = await getDB();
    const user = { id: "u-credits", email: "credits@test.local", name: "", passwordHash: "x", role: "user" as const, plan: "free", planExpires: null, createdAt: Date.now(), disabled: 0, emailVerified: 1, verifyCode: null, verifyExpires: null };
    await db.createUser(user);
    const t0 = Date.parse("2026-09-15T02:00:00Z"); // Tuesday, first day of the third week of September
    const H = 3600000;
    let q = await quota(user, t0);
    expect(q.session).toMatchObject({ used: 0, limit: 8, resetsAt: null });
    expect(q.remaining).toBe(8);

    // one question on Gemini 3.5 Flash-Lite in two model calls ≈ 4.25 credits; the session starts now
    await recordUsage(user.id, "gemini", "gemini-3.5-flash-lite", 10000, 500, true, t0);
    await recordUsage(user.id, "gemini", "gemini-3.5-flash-lite", 10000, 500, false, t0 + 1000);
    q = await quota(user, t0 + H);
    expect(q.session.used).toBeCloseTo(4.25, 2);
    expect(q.session.resetsAt).toBe(t0 + 5 * H);
    expect((await db.getUsage(user.id, "2026-09-15")).requests).toBe(1);

    // two more questions go past the 8-credit session limit (the answer that started is still finished)
    await recordUsage(user.id, "gemini", "gemini-3.8-flash", 5000, 500, true, t0 + 2 * H); // ≈ 2.8
    await recordUsage(user.id, "gemini", "gemini-3.8-flash", 6000, 400, true, t0 + 2 * H); // ≈ 3.0
    q = await quota(user, t0 + 3 * H);
    expect(q.blockedBy).toBe("session");
    expect(limitMessage(q)).toMatch(/8-credit limit for this 5-hour session.*new session starts/);

    // after 5 hours a new session begins; the week keeps counting (15 − 10.05 left)
    q = await quota(user, t0 + 6 * H);
    expect(q.session.used).toBe(0);
    expect(q.week.used).toBeCloseTo(10.05, 1);
    expect(q.remaining).toBeCloseTo(4.95, 1);

    // two Claude Haiku questions later that week pass the 15-credit weekly limit
    await recordUsage(user.id, "anthropic", "claude-haiku-4-5", 4000, 400, true, t0 + 6 * H); // 3
    await recordUsage(user.id, "anthropic", "claude-haiku-4-5", 4000, 400, true, t0 + 30 * H); // 3
    q = await quota(user, t0 + 31 * H);
    expect(q.blockedBy).toBe("week");
    expect(limitMessage(q)).toMatch(/this week's limit of 15.*monthly credits are kept/);

    // next week the weekly limit refills, the month keeps counting
    q = await quota(user, Date.parse("2026-09-22T03:00:00Z"));
    expect(q.week.used).toBe(0);
    expect(q.period.used).toBeCloseTo(16.05, 1);
    expect(q.blockedBy).toBeNull();
  });
});
