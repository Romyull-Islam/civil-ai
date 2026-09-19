/**
 * Company edition: offline licence (signature, trial, expiry and grace), seat limit, the internal company plan
 * (admin limits, 0 = unlimited) and the topic guard default. Uses a throw-away SQLite database.
 */
import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateKeyPairSync, sign } from "node:crypto";
import { verifyLicense, evaluateLicense, TRIAL_DAYS, TRIAL_SEATS, GRACE_DAYS, type LicensePayload } from "@/lib/company/license";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const PUB = publicKey.export({ type: "spki", format: "pem" }).toString();
const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function issue(p: Omit<LicensePayload, "v" | "id" | "issued">) {
  const head = `CM1.${b64u(JSON.stringify({ v: 1, id: "t", issued: "2026-01-01", ...p }))}`;
  return `${head}.${b64u(sign(null, Buffer.from(head), privateKey))}`;
}
const day = 86400000;
const NOW = Date.parse("2026-09-18T12:00:00Z");

describe("licence", () => {
  it("verifies the signature and rejects edits and other formats", () => {
    const lic = issue({ company: "ABC Construction", seats: 25, expires: "2027-12-31" });
    expect(verifyLicense(lic, PUB)).toMatchObject({ company: "ABC Construction", seats: 25 });
    const [h, body, sig] = lic.split(".");
    const forged = `${h}.${b64u(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64").toString()), seats: 500 }))}.${sig}`;
    expect(() => verifyLicense(forged, PUB)).toThrow(/signature/);
    expect(() => verifyLicense("hello", PUB)).toThrow(/CM1/);
    const other = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString();
    expect(() => verifyLicense(lic, other)).toThrow(/signature/);
  });
  it("evaluation period, then the assistant stops (calculators keep working)", () => {
    const t = evaluateLicense(null, { installedAt: NOW - 10 * day, now: NOW });
    expect(t).toMatchObject({ status: "trial", seats: TRIAL_SEATS, chatAllowed: true, daysLeft: TRIAL_DAYS - 10 });
    expect(evaluateLicense(null, { installedAt: NOW - (TRIAL_DAYS + 1) * day, now: NOW })).toMatchObject({ status: "trial_ended", chatAllowed: false });
  });
  it("active, expiring, grace and expired", () => {
    const p = (expires: string | null): LicensePayload => ({ v: 1, id: "x", company: "C", seats: 10, issued: "2026-01-01", expires });
    expect(evaluateLicense(p(null), { installedAt: 0, now: NOW })).toMatchObject({ status: "active", chatAllowed: true, expires: null });
    expect(evaluateLicense(p("2027-01-01"), { installedAt: 0, now: NOW }).status).toBe("active");
    expect(evaluateLicense(p("2026-10-01"), { installedAt: 0, now: NOW })).toMatchObject({ status: "expiring", chatAllowed: true });
    expect(evaluateLicense(p("2026-09-01"), { installedAt: 0, now: NOW })).toMatchObject({ status: "grace", chatAllowed: true });
    const old = new Date(NOW - (GRACE_DAYS + 2) * day).toISOString().slice(0, 10);
    expect(evaluateLicense(p(old), { installedAt: 0, now: NOW })).toMatchObject({ status: "expired", chatAllowed: false });
  });
});

describe("company install", () => {
  beforeAll(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "civilmate-company-"));
    process.env.DATABASE_PATH = path.join(dir, "db.sqlite");
    delete process.env.DATABASE_URL;
    process.env.CIVIL_AI_MODE = "company";
    process.env.GEMINI_API_KEY = "test-key"; // the company's own key
    delete process.env.CIVIL_AI_LICENSE;
  });

  it("uses one internal plan: unlimited by default, admin limits when set, only providers with keys", async () => {
    const { companyPlan, setCompanySettings, DEFAULT_COMPANY } = await import("@/lib/company");
    const unlimited = await companyPlan();
    expect(unlimited.monthlyCredits).toBe(Infinity);
    expect(unlimited.providers.map((p) => p.provider)).toContain("gemini");
    expect(unlimited.providers.map((p) => p.provider)).not.toContain("anthropic"); // no key → not offered
    await setCompanySettings({ ...DEFAULT_COMPANY, monthlyCredits: 800, weeklyCredits: 300, sessionCredits: 0 });
    const limited = await companyPlan();
    expect([limited.monthlyCredits, limited.weeklyCredits, limited.sessionCredits]).toEqual([800, 300, Infinity]);
    const { planFor, quota } = await import("@/lib/saas/service");
    const u = { id: "u1", email: "a@b.c", name: "", passwordHash: "", role: "user" as const, plan: "free", planExpires: null, createdAt: 0, disabled: 0, emailVerified: 1, verifyCode: null, verifyExpires: null };
    expect((await planFor(u)).id).toBe("company");
    const q = await quota(u);
    expect(q.period.limit).toBe(800);
    await setCompanySettings(DEFAULT_COMPANY);
  });

  it("first account is the owner; the trial allows 3 active users; admins cannot exceed seats", async () => {
    const { signup, createAccount, verificationRequired } = await import("@/lib/saas/service");
    expect(await verificationRequired()).toBe(false);
    const owner = await signup("owner@abc.test", "password123", "Owner");
    expect(owner.user.role).toBe("superadmin");
    await createAccount("u1@abc.test", "password123", "user");
    await createAccount("u2@abc.test", "password123", "user");
    await expect(createAccount("u3@abc.test", "password123", "user")).rejects.toThrow(/licence allows 3/);
  });

  it("refuses unrelated questions before any model call when the guard is on", async () => {
    const { checkTopic } = await import("@/lib/ai/topic");
    expect(checkTopic([{ role: "user", parts: [{ type: "text", text: "write a poem" }] }], true).action).toBe("reply");
  });
});
