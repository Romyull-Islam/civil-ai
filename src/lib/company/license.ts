/**
 * Offline licence for the company edition. A licence is a small signed text ("CM1.<payload>.<signature>") that the
 * vendor issues with scripts/license.mjs; it is checked here with the embedded public key and never sent anywhere.
 *  - seats: maximum active (not disabled) user accounts
 *  - expires: end of the licence / maintenance period (null = perpetual); the AI assistant keeps working for
 *    GRACE_DAYS after expiry, then stops until a renewed licence is entered (calculators and drawings keep working)
 *  - without a licence: a TRIAL_DAYS evaluation for up to TRIAL_SEATS users
 */
import { createPublicKey, verify } from "node:crypto";
import { getDB } from "@/lib/saas/db";
import { LICENSE_PUBLIC_KEY } from "./license-key";

export const TRIAL_DAYS = 30;
export const TRIAL_SEATS = 3;
export const GRACE_DAYS = 30;

export interface LicensePayload { v: 1; id: string; company: string; seats: number; issued: string; expires: string | null }
export interface LicenseState {
  status: "trial" | "trial_ended" | "active" | "expiring" | "grace" | "expired" | "invalid";
  company: string | null;
  seats: number;
  expires: string | null; // YYYY-MM-DD
  daysLeft: number | null;
  /** the AI assistant may be used */
  chatAllowed: boolean;
  message: string | null;
  source: "env" | "admin" | null;
}

const b64u = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

/** Verify a licence string with a PEM public key; returns the payload or throws. */
export function verifyLicense(text: string, publicKeyPem = LICENSE_PUBLIC_KEY): LicensePayload {
  const parts = text.trim().split(".");
  if (parts.length !== 3 || parts[0] !== "CM1") throw new Error("Not a CivilMate licence (it should start with CM1.)");
  const ok = verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey(publicKeyPem), b64u(parts[2]));
  if (!ok) throw new Error("The licence signature is not valid");
  const p = JSON.parse(b64u(parts[1]).toString("utf8")) as LicensePayload;
  if (p.v !== 1 || !p.company || !(p.seats > 0)) throw new Error("The licence content is not valid");
  return p;
}

const dayMs = 86400000;
const endOfDay = (d: string) => Date.parse(`${d}T23:59:59Z`);

export function evaluateLicense(payload: LicensePayload | null, opts: { installedAt: number; now?: number; invalid?: string; source?: LicenseState["source"] }): LicenseState {
  const now = opts.now ?? Date.now();
  if (opts.invalid) return { status: "invalid", company: null, seats: TRIAL_SEATS, expires: null, daysLeft: null, chatAllowed: false, message: `Licence problem: ${opts.invalid}. Ask your administrator to enter a valid licence (Admin → Company).`, source: opts.source ?? null };
  if (!payload) {
    const end = opts.installedAt + TRIAL_DAYS * dayMs;
    const daysLeft = Math.ceil((end - now) / dayMs);
    if (daysLeft > 0) return { status: "trial", company: null, seats: TRIAL_SEATS, expires: new Date(end).toISOString().slice(0, 10), daysLeft, chatAllowed: true, message: `Evaluation copy: ${daysLeft} day(s) left, up to ${TRIAL_SEATS} users. Enter a licence in Admin → Company.`, source: null };
    return { status: "trial_ended", company: null, seats: TRIAL_SEATS, expires: new Date(end).toISOString().slice(0, 10), daysLeft: 0, chatAllowed: false, message: "The evaluation period has ended. Calculators and drawings still work; the AI assistant needs a licence (Admin → Company).", source: null };
  }
  if (!payload.expires) return { status: "active", company: payload.company, seats: payload.seats, expires: null, daysLeft: null, chatAllowed: true, message: null, source: opts.source ?? null };
  const end = endOfDay(payload.expires);
  const daysLeft = Math.ceil((end - now) / dayMs);
  const base = { company: payload.company, seats: payload.seats, expires: payload.expires, daysLeft, source: opts.source ?? null };
  if (daysLeft > 30) return { ...base, status: "active", chatAllowed: true, message: null };
  if (daysLeft > 0) return { ...base, status: "expiring", chatAllowed: true, message: `The CivilMate licence expires on ${payload.expires} (${daysLeft} day(s)). Contact your CivilMate provider to renew.` };
  if (daysLeft > -GRACE_DAYS) return { ...base, status: "grace", chatAllowed: true, message: `The CivilMate licence expired on ${payload.expires}. The AI assistant stops in ${GRACE_DAYS + daysLeft} day(s) unless it is renewed.` };
  return { ...base, status: "expired", chatAllowed: false, message: `The CivilMate licence expired on ${payload.expires}. Calculators and drawings still work; the AI assistant needs a renewed licence (Admin → Company).` };
}

/** Current licence: CIVIL_AI_LICENSE (environment) wins over the one entered in Admin → Company. */
export async function licenseState(now = Date.now()): Promise<LicenseState> {
  const db = await getDB();
  let installed = Number(await db.getSetting("company:installedAt"));
  if (!installed) { installed = now; await db.setSetting("company:installedAt", String(now)); }
  const env = process.env.CIVIL_AI_LICENSE?.trim();
  const stored = env ? null : (await db.getSetting("company:license"))?.trim();
  const text = env || stored;
  if (!text) return evaluateLicense(null, { installedAt: installed, now });
  try { return evaluateLicense(verifyLicense(text), { installedAt: installed, now, source: env ? "env" : "admin" }); }
  catch (e) { return evaluateLicense(null, { installedAt: installed, now, invalid: (e as Error).message, source: env ? "env" : "admin" }); }
}

export async function saveLicense(text: string): Promise<LicensePayload> {
  const p = verifyLicense(text);
  await (await getDB()).setSetting("company:license", text.trim());
  return p;
}

/** Throws when adding or re-enabling one more active user would exceed the licensed seats. */
export async function assertSeatAvailable() {
  const lic = await licenseState();
  const active = (await (await getDB()).listUsers()).filter((u) => !u.disabled).length;
  if (active >= lic.seats) throw new Error(`The licence allows ${lic.seats} active user(s) and ${active} are active. Disable a user or ask your CivilMate provider for more seats.`);
}
