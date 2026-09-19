/** Email verification gate: an unverified account can use nothing until it confirms its address (unless the admin set "never"). */
import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("email verification gate", () => {
  beforeAll(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "civilmate-verify-"));
    process.env.DATABASE_PATH = path.join(dir, "db.sqlite");
    delete process.env.DATABASE_URL;
    process.env.CIVIL_AI_MODE = "saas";
    for (const k of ["SMTP_HOST", "RESEND_API_KEY", "BREVO_API_KEY"]) delete process.env[k];
  });
  it("no sign-in before verification: sign-up gives no session, sign-in is refused, the right code signs in", async () => {
    const { signup, login, verifyEmailAndSignIn, requireVerifiedUser, needsVerification } = await import("@/lib/saas/service");
    const { getSite, setSite } = await import("@/lib/saas/site");
    const { getDB } = await import("@/lib/saas/db");
    await setSite({ ...(await getSite()), requireEmailVerification: "always" });
    await signup("owner@test.example", "password123"); // first account = owner (superadmin), signed in to set up the site
    const s = await signup("user@test.example", "password123");
    expect(s.token).toBeNull(); // no session yet
    expect(s.user.emailVerified).toBe(0);
    const l = await login("user@test.example", "password123");
    expect(l.needsVerification).toBe(true);
    expect(l.token).toBe(""); // still no session
    await expect(login("user@test.example", "wrong-password")).rejects.toThrow(/Invalid email or password/);
    expect(await verifyEmailAndSignIn("user@test.example", "000000")).toBeNull();
    const fresh = await (await getDB()).getUserByEmail("user@test.example");
    const ok = await verifyEmailAndSignIn("USER@test.example", fresh!.verifyCode!);
    expect(ok?.token).toBeTruthy();
    const req = new Request("http://x/api/tools", { headers: { cookie: `civil_session=${ok!.token}` } });
    expect(await requireVerifiedUser(req)).not.toBeInstanceOf(Response);
    expect((await login("user@test.example", "password123")).token).toBeTruthy(); // normal sign-in from now on
    // A verified account can never be entered through the code endpoint (no password): any code, even the old one
    expect(await verifyEmailAndSignIn("user@test.example", fresh!.verifyCode!)).toBeNull();
    expect(await verifyEmailAndSignIn("user@test.example", "123456")).toBeNull();
    expect(await verifyEmailAndSignIn("owner@test.example", "")).toBeNull();
    // Admin setting "never": nobody is held back
    await setSite({ ...(await getSite()), requireEmailVerification: "never" });
    expect(await needsVerification({ ...fresh!, emailVerified: 0 })).toBe(false);
  });
});
