/**
 * Email delivery must never hang sign-up: hosts such as Render's free plan block SMTP ports, which made sign-up wait
 * about two minutes. Transports are tried in order with short timeouts and failures fall through.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { sendEmail } from "@/lib/saas/email";

const clear = () => { for (const k of ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "RESEND_API_KEY", "BREVO_API_KEY", "EMAIL_FROM"]) delete process.env[k]; };

describe("sendEmail", () => {
  beforeEach(clear);
  it("reports failure quickly when the SMTP port is closed (no hang)", async () => {
    Object.assign(process.env, { SMTP_HOST: "127.0.0.1", SMTP_PORT: "1", SMTP_USER: "u@example.com", SMTP_PASS: "x" });
    const t = Date.now();
    const r = await sendEmail("a@example.com", "s", "t");
    expect(r).toEqual({ delivered: false, via: "smtp" });
    expect(Date.now() - t).toBeLessThan(12000);
  }, 20000);
  it("gives up on an unreachable SMTP server within the connection timeout", async () => {
    Object.assign(process.env, { SMTP_HOST: "10.255.255.1", SMTP_PORT: "465", SMTP_USER: "u@example.com", SMTP_PASS: "x" }); // non-routable: packets vanish, like a blocked port
    const t = Date.now();
    const r = await sendEmail("a@example.com", "s", "t");
    expect(r.delivered).toBe(false);
    expect(Date.now() - t).toBeLessThan(25000);
  }, 40000);
  it("tries the HTTPS API first and falls through to SMTP when it fails", async () => {
    Object.assign(process.env, { BREVO_API_KEY: "invalid-key", SMTP_HOST: "127.0.0.1", SMTP_PORT: "1", SMTP_USER: "u@example.com", SMTP_PASS: "x" });
    const r = await sendEmail("a@example.com", "s", "t");
    expect(r).toEqual({ delivered: false, via: "brevo,smtp" });
  }, 40000);
  it("without any transport the code is logged (development)", async () => {
    expect(await sendEmail("a@example.com", "s", "t")).toEqual({ delivered: false, via: "console" });
  });
});
