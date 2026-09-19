import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { vatBreakdown, isOnlinePayment } from "@/lib/saas/billing";
import { DEFAULT_PLANS, DEFAULT_CREDIT_PACKS } from "@/lib/saas/plans";

describe("billing maths", () => {
  it("carves VAT out of inclusive prices and adds it to exclusive ones", () => {
    expect(vatBreakdown(300, 0, true)).toEqual({ net: 300, vat: 0, total: 300 });
    expect(vatBreakdown(345, 15, true)).toEqual({ net: 300, vat: 45, total: 345 });
    expect(vatBreakdown(300, 15, false)).toEqual({ net: 300, vat: 45, total: 345 });
  });
  it("tells online checkouts from manual transfers, including legacy manual bKash", () => {
    expect(isOnlinePayment({ method: "sslcommerz", txnId: "CIVABC123" })).toBe(true);
    expect(isOnlinePayment({ method: "bkash", txnId: "9K7A3B2C1D" })).toBe(false);
    expect(isOnlinePayment({ method: "bkash-manual", txnId: "9K7A3B2C1D" })).toBe(false);
  });
  it("credit packs keep AI cost under half the price", () => {
    for (const p of DEFAULT_CREDIT_PACKS) expect((p.credits * 0.002 * 122) / p.price, p.id).toBeLessThan(0.5);
  });
  it("changing plan converts unused days at each plan's daily price", async () => {
    const { carryOverDays } = await import("@/lib/saas/service");
    const [, pro, max] = DEFAULT_PLANS;
    const now = Date.parse("2026-09-18T00:00:00Z");
    expect(carryOverDays({ plan: pro, expires: now + 30 * 86400000 }, max, now)).toBe(9); // ৳300 of Pro = 9 days of Max
    expect(carryOverDays({ plan: max, expires: now + 3 * 86400000 }, pro, now)).toBe(10); // ৳100 of Max = 10 days of Pro
    expect(carryOverDays({ plan: pro, expires: now - 1 }, max, now)).toBe(0);
    expect(carryOverDays({ plan: pro, expires: now + 10 * 86400000 }, pro, now)).toBe(0); // renewal simply extends
  });
});

describe("checkout against a real database with a fake gateway", () => {
  beforeAll(() => {
    process.env.DATABASE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "civilmate-pay-")), "t.sqlite");
    // TEST_PG_URL=postgres://… runs the same tests against Postgres (production database engine).
    if (process.env.TEST_PG_URL) process.env.DATABASE_URL = process.env.TEST_PG_URL; else delete process.env.DATABASE_URL;
  });
  const setup = async (email: string, role = "admin") => {
    const { getDB } = await import("@/lib/saas/db");
    const { setGatewayConfig } = await import("@/lib/saas/gateways");
    const { sslcommerz } = await import("@/lib/saas/gateways/sslcommerz");
    let verifyCalls = 0;
    sslcommerz.createCheckout = async () => ({ url: "https://sandbox.example/pay", providerRef: "ref" });
    sslcommerz.verify = async (_cfg, params) => { verifyCalls++; await new Promise((r) => setTimeout(r, 20)); return params.outcome === "cancel" ? { ok: false, status: "cancelled" } : { ok: true, status: "paid", txnId: "BANK1" }; };
    await setGatewayConfig("sslcommerz", { enabled: true, sandbox: true, values: { store_id: "x", store_passwd: "y" } });
    const db = await getDB();
    const run = Math.random().toString(36).slice(2, 8); // unique per run, so a shared Postgres test database can be reused
    const user = { id: `u-${run}-${email}`, email: `${run}-${email}`, name: "", passwordHash: "x", role: role as "user" | "admin", plan: "free", planExpires: null, createdAt: Date.now(), disabled: 0, emailVerified: 1, verifyCode: null, verifyExpires: null };
    await db.createUser(user);
    return { db, user, calls: () => verifyCalls };
  };

  it("activates a plan exactly once when return, IPN and re-checks arrive together", async () => {
    const { db, user } = await setup("once@test.local");
    const { startCheckout, completeCheckout } = await import("@/lib/saas/checkout");
    const { paymentId } = await startCheckout(user, "pro", "sslcommerz", "http://localhost");
    const results = await Promise.all([1, 2, 3, 4].map(() => completeCheckout("sslcommerz", paymentId, { outcome: "success", val_id: "V" }, "http://localhost")));
    expect(results.filter((r) => r.status === "paid")).toHaveLength(1);
    expect(results.filter((r) => r.status === "already")).toHaveLength(3);
    const u = await db.getUserById(user.id);
    expect(u?.plan).toBe("pro");
    expect(Math.round((u!.planExpires! - Date.now()) / 86400000)).toBe(30);
  });

  it("a credit pack adds extra credits; a refund with revoke cancels the unused ones", async () => {
    const { db, user } = await setup("pack@test.local");
    const { startCheckout, completeCheckout } = await import("@/lib/saas/checkout");
    const { refundPayment } = await import("@/lib/saas/service");
    const { paymentId } = await startCheckout(user, "credits:small", "sslcommerz", "http://localhost");
    expect((await completeCheckout("sslcommerz", paymentId, { outcome: "success", val_id: "V" }, "http://localhost")).status).toBe("paid");
    expect((await db.listCreditGrants(user.id, Date.now()))[0]).toMatchObject({ credits: 180, remaining: 180 });
    const p = await db.getPaymentByTxn(paymentId, "sslcommerz");
    expect(p?.amount).toBe(100);
    await refundPayment(p!.id, true, "test");
    expect((await db.getPayment(p!.id))?.status).toBe("refunded");
    expect((await db.listCreditGrants(user.id, Date.now()))[0].remaining).toBe(0);
  });

  it("customers cannot check out through a gateway in test mode; staff can", async () => {
    const { user } = await setup("customer@test.local", "user");
    const { startCheckout } = await import("@/lib/saas/checkout");
    const { enabledGateways } = await import("@/lib/saas/gateways");
    await expect(startCheckout(user, "pro", "sslcommerz", "http://localhost")).rejects.toThrow(/not available/);
    expect((await enabledGateways()).map((g) => g.id)).not.toContain("sslcommerz");
    expect((await enabledGateways(true)).map((g) => g.id)).toContain("sslcommerz");
  });

  it("manual claims cannot use online methods or references", async () => {
    const { user } = await setup("manual@test.local");
    const { submitPayment } = await import("@/lib/saas/service");
    await expect(submitPayment(user, { plan: "pro", method: "sslcommerz", amount: 300, currency: "BDT", txnId: "X1", sender: "" })).rejects.toThrow(/Choose bKash/);
    await expect(submitPayment(user, { plan: "pro", method: "bkash-manual", amount: 300, currency: "BDT", txnId: "civABC", sender: "" })).rejects.toThrow(/transaction ID/);
    const ok = await submitPayment(user, { plan: "pro", method: "bkash-manual", amount: 300, currency: "BDT", txnId: "9K7A3B2C1D", sender: "017" });
    expect(ok.status).toBe("pending");
  });

  it("staff approval activates once even if clicked twice; a cancelled checkout is marked failed", async () => {
    const { db, user } = await setup("approve@test.local");
    const { submitPayment, reviewPayment } = await import("@/lib/saas/service");
    const { startCheckout, completeCheckout } = await import("@/lib/saas/checkout");
    const p = await submitPayment(user, { plan: "pro", method: "nagad", amount: 300, currency: "BDT", txnId: "NG12345", sender: "018" });
    await Promise.all([reviewPayment(p.id, "approved"), reviewPayment(p.id, "approved")]);
    const u = await db.getUserById(user.id);
    expect(Math.round((u!.planExpires! - Date.now()) / 86400000)).toBe(30);
    const { paymentId } = await startCheckout(user, "pro", "sslcommerz", "http://localhost");
    expect((await completeCheckout("sslcommerz", paymentId, { outcome: "cancel" }, "http://localhost")).status).toBe("cancelled");
    expect((await db.getPaymentByTxn(paymentId, "sslcommerz"))?.status).toBe("rejected");
  });
});
