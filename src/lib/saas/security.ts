/** Security helpers: in-memory rate limiting (per instance), login lockout, audit log, TOTP (RFC 6238) for staff 2FA. */
import { createHmac, randomBytes } from "node:crypto";
import { getDB } from "./db";

// ---- rate limiting (per process; fronted by the platform's own limits on Vercel/Render) ----
const buckets = new Map<string, number[]>();
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const arr = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { buckets.set(key, arr); return false; }
  arr.push(now); buckets.set(key, arr);
  if (buckets.size > 50000) buckets.clear();
  return true;
}
export const clientIp = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";

// ---- login lockout (persistent, per account) ----
export async function loginFailed(email: string): Promise<{ locked: boolean; minutes?: number }> {
  const db = await getDB();
  const key = `lock:${email.toLowerCase()}`;
  const rec = JSON.parse((await db.getSetting(key)) || "{\"n\":0,\"t\":0}") as { n: number; t: number; until?: number };
  if (Date.now() - rec.t > 15 * 60000) { rec.n = 0; }
  rec.n += 1; rec.t = Date.now();
  if (rec.n >= 8) rec.until = Date.now() + 15 * 60000;
  await db.setSetting(key, JSON.stringify(rec));
  return rec.until && rec.until > Date.now() ? { locked: true, minutes: 15 } : { locked: false };
}
export async function isLocked(email: string): Promise<boolean> {
  const rec = JSON.parse((await (await getDB()).getSetting(`lock:${email.toLowerCase()}`)) || "{}") as { until?: number };
  return !!rec.until && rec.until > Date.now();
}
export async function loginSucceeded(email: string) { await (await getDB()).setSetting(`lock:${email.toLowerCase()}`, ""); }

// ---- audit log (admin actions) ----
export async function audit(actorId: string, action: string, target = "", detail = "") {
  const db = await getDB();
  const key = `audit:${Date.now()}:${randomBytes(3).toString("hex")}`;
  await db.setSetting(key, JSON.stringify({ t: Date.now(), actorId, action, target, detail: detail.slice(0, 300) }));
}

// ---- TOTP ----
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32Encode(buf: Buffer): string { let bits = 0, val = 0, out = ""; for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } } if (bits > 0) out += B32[(val << (5 - bits)) & 31]; return out; }
export function base32Decode(s: string): Buffer { let bits = 0, val = 0; const out: number[] = []; for (const c of s.replace(/=+$/, "").toUpperCase()) { const i = B32.indexOf(c); if (i < 0) continue; val = (val << 5) | i; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); }
export function totp(secret: string, step = 30, digits = 6, at = Date.now()): string {
  const counter = Math.floor(at / 1000 / step);
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", base32Decode(secret)).update(msg).digest();
  const off = h[h.length - 1] & 15;
  const code = ((h[off] & 0x7f) << 24 | h[off + 1] << 16 | h[off + 2] << 8 | h[off + 3]) % 10 ** digits;
  return String(code).padStart(digits, "0");
}
export function totpVerify(secret: string, code: string): boolean { const c = code.replace(/\s/g, ""); return [-1, 0, 1].some((w) => totp(secret, 30, 6, Date.now() + w * 30000) === c); }
export const newTotpSecret = () => base32Encode(randomBytes(20));
export const otpauthUrl = (issuer: string, account: string, secret: string) => `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30`;
