import { randomBytes, scryptSync, timingSafeEqual, createCipheriv, createDecipheriv, createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pw, salt, 64, { N: 16384 }).toString("hex");
  return `scrypt$16384$${salt}$${hash}`;
}
export function verifyPassword(pw: string, stored: string): boolean {
  const [alg, n, salt, hash] = stored.split("$");
  if (alg !== "scrypt") return false;
  const calc = scryptSync(pw, salt, 64, { N: Number(n) });
  const ref = Buffer.from(hash, "hex");
  return calc.length === ref.length && timingSafeEqual(calc, ref);
}

/** Server secret for encrypting provider keys and signing nothing else. Set CIVIL_AI_SECRET in production (Vercel env). */
export function serverSecret(): string {
  if (process.env.CIVIL_AI_SECRET) return process.env.CIVIL_AI_SECRET;
  const dir = process.env.CIVIL_AI_USER_DATA || path.join(os.homedir(), ".civil-ai");
  const file = path.join(dir, "secret.key");
  try { return fs.readFileSync(file, "utf8").trim(); } catch { /* create */ }
  fs.mkdirSync(dir, { recursive: true });
  const s = randomBytes(32).toString("hex");
  fs.writeFileSync(file, s, { mode: 0o600 });
  return s;
}
const key = () => createHash("sha256").update(serverSecret()).digest();
export function encrypt(text: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return `${iv.toString("hex")}.${c.getAuthTag().toString("hex")}.${enc.toString("hex")}`;
}
export function decrypt(blob: string): string {
  const [iv, tag, data] = blob.split(".");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "hex"));
  d.setAuthTag(Buffer.from(tag, "hex"));
  return Buffer.concat([d.update(Buffer.from(data, "hex")), d.final()]).toString("utf8");
}
export const newToken = () => randomBytes(32).toString("hex");
export const newId = () => randomBytes(12).toString("hex");
