/** Minimal repository over SQLite (node:sqlite, zero-config; desktop/VPS) or Postgres (DATABASE_URL; Vercel + Supabase/Neon). */
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

export type Role = "superadmin" | "admin" | "support" | "user";
export const ROLES: Role[] = ["superadmin", "admin", "support", "user"];
export const isStaff = (r: Role) => r !== "user";

export interface User { id: string; email: string; name: string; passwordHash: string; role: Role; plan: string; planExpires: number | null; createdAt: number; disabled: number; emailVerified: number; verifyCode: string | null; verifyExpires: number | null }
export interface Payment { id: string; userId: string; email: string; plan: string; method: string; amount: number; currency: string; txnId: string; sender: string; status: "pending" | "approved" | "rejected"; note: string; createdAt: number; reviewedAt: number | null }
export interface Ticket { id: string; userId: string | null; email: string; subject: string; message: string; status: "open" | "answered" | "closed"; reply: string; createdAt: number; updatedAt: number }
export interface Session { token: string; userId: string; expires: number }
export interface UsageRow { day: string; requests: number; inputTokens: number; outputTokens: number }

export interface DB {
  init(): Promise<void>;
  getUserByEmail(email: string): Promise<User | null>;
  getUserById(id: string): Promise<User | null>;
  createUser(u: User): Promise<void>;
  updateUser(id: string, patch: Partial<Pick<User, "name" | "role" | "plan" | "planExpires" | "passwordHash" | "disabled">>): Promise<void>;
  deleteUser(id: string): Promise<void>;
  listUsers(limit?: number): Promise<User[]>;
  countUsers(): Promise<number>;
  createSession(s: Session): Promise<void>;
  getSession(token: string): Promise<Session | null>;
  deleteSession(token: string): Promise<void>;
  deleteSessionsForUser(userId: string): Promise<void>;
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
  addUsage(userId: string, day: string, requests: number, inputTokens: number, outputTokens: number): Promise<void>;
  getUsage(userId: string, day: string): Promise<UsageRow>;
  usageByDay(days: number): Promise<UsageRow[]>;
  usageByUser(days: number, limit?: number): Promise<(UsageRow & { userId: string; email: string })[]>;
  setVerification(id: string, code: string | null, expires: number | null, verified?: number): Promise<void>;
  createPayment(p: Payment): Promise<void>;
  listPayments(opts: { userId?: string; status?: string; limit?: number }): Promise<Payment[]>;
  updatePayment(id: string, patch: Partial<Pick<Payment, "status" | "note" | "reviewedAt">>): Promise<void>;
  getPayment(id: string): Promise<Payment | null>;
  createTicket(t: Ticket): Promise<void>;
  listTickets(opts: { userId?: string; status?: string; limit?: number }): Promise<Ticket[]>;
  updateTicket(id: string, patch: Partial<Pick<Ticket, "status" | "reply" | "updatedAt">>): Promise<void>;
}

const SCHEMA = (big: string) => [
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL DEFAULT '', password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', plan TEXT NOT NULL DEFAULT 'free', plan_expires ${big}, created_at ${big} NOT NULL, disabled INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires ${big} NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS usage (user_id TEXT NOT NULL, day TEXT NOT NULL, requests INTEGER NOT NULL DEFAULT 0, input_tokens ${big} NOT NULL DEFAULT 0, output_tokens ${big} NOT NULL DEFAULT 0, PRIMARY KEY (user_id, day))`,
  `CREATE TABLE IF NOT EXISTS payments (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, email TEXT NOT NULL, plan TEXT NOT NULL, method TEXT NOT NULL, amount REAL NOT NULL, currency TEXT NOT NULL, txn_id TEXT NOT NULL, sender TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', note TEXT NOT NULL DEFAULT '', created_at ${big} NOT NULL, reviewed_at ${big})`,
  `CREATE TABLE IF NOT EXISTS tickets (id TEXT PRIMARY KEY, user_id TEXT, email TEXT NOT NULL, subject TEXT NOT NULL, message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', reply TEXT NOT NULL DEFAULT '', created_at ${big} NOT NULL, updated_at ${big} NOT NULL)`,
];
/** Additive migrations (ignored when the column already exists). */
const MIGRATIONS = (big: string) => [
  `ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE users ADD COLUMN verify_code TEXT`,
  `ALTER TABLE users ADD COLUMN verify_expires ${big}`,
];

type Row = Record<string, unknown>;
const toUser = (r: Row): User => ({ id: String(r.id), email: String(r.email), name: String(r.name ?? ""), passwordHash: String(r.password_hash), role: (ROLES as string[]).includes(String(r.role)) ? (r.role as Role) : "user", plan: String(r.plan), planExpires: r.plan_expires == null ? null : Number(r.plan_expires), createdAt: Number(r.created_at), disabled: Number(r.disabled ?? 0), emailVerified: Number(r.email_verified ?? 0), verifyCode: r.verify_code == null ? null : String(r.verify_code), verifyExpires: r.verify_expires == null ? null : Number(r.verify_expires) });
const toPayment = (r: Row): Payment => ({ id: String(r.id), userId: String(r.user_id), email: String(r.email), plan: String(r.plan), method: String(r.method), amount: Number(r.amount), currency: String(r.currency), txnId: String(r.txn_id), sender: String(r.sender ?? ""), status: r.status as Payment["status"], note: String(r.note ?? ""), createdAt: Number(r.created_at), reviewedAt: r.reviewed_at == null ? null : Number(r.reviewed_at) });
const toTicket = (r: Row): Ticket => ({ id: String(r.id), userId: r.user_id == null ? null : String(r.user_id), email: String(r.email), subject: String(r.subject), message: String(r.message), status: r.status as Ticket["status"], reply: String(r.reply ?? ""), createdAt: Number(r.created_at), updatedAt: Number(r.updated_at) });
const toUsage = (r: Row | undefined): UsageRow => ({ day: String(r?.day ?? ""), requests: Number(r?.requests ?? 0), inputTokens: Number(r?.input_tokens ?? 0), outputTokens: Number(r?.output_tokens ?? 0) });
const dayCutoff = (days: number) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

/** Generic SQL-backed implementation; `run`/`all` are provided per dialect. */
function makeDB(run: (sql: string, params?: unknown[]) => Promise<void>, all: (sql: string, params?: unknown[]) => Promise<Row[]>, big: string, upsertUsage: string): DB {
  const one = async (sql: string, p?: unknown[]) => (await all(sql, p))[0];
  return {
    async init() { for (const s of SCHEMA(big)) await run(s); for (const m of MIGRATIONS(big)) { try { await run(m); } catch { /* column exists */ } } },
    async getUserByEmail(email) { const r = await one("SELECT * FROM users WHERE email = ?", [email.toLowerCase()]); return r ? toUser(r) : null; },
    async getUserById(id) { const r = await one("SELECT * FROM users WHERE id = ?", [id]); return r ? toUser(r) : null; },
    async createUser(u) { await run("INSERT INTO users (id, email, name, password_hash, role, plan, plan_expires, created_at, disabled, email_verified, verify_code, verify_expires) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", [u.id, u.email.toLowerCase(), u.name, u.passwordHash, u.role, u.plan, u.planExpires, u.createdAt, u.disabled, u.emailVerified, u.verifyCode, u.verifyExpires]); },
    async updateUser(id, patch) {
      const cols: string[] = []; const vals: unknown[] = [];
      const map: Record<string, string> = { name: "name", role: "role", plan: "plan", planExpires: "plan_expires", passwordHash: "password_hash", disabled: "disabled" };
      for (const [k, v] of Object.entries(patch)) if (k in map && v !== undefined) { cols.push(`${map[k]} = ?`); vals.push(v); }
      if (!cols.length) return;
      await run(`UPDATE users SET ${cols.join(", ")} WHERE id = ?`, [...vals, id]);
    },
    async deleteUser(id) { await run("DELETE FROM sessions WHERE user_id = ?", [id]); await run("DELETE FROM users WHERE id = ?", [id]); },
    async listUsers(limit = 500) { return (await all("SELECT * FROM users ORDER BY created_at DESC LIMIT ?", [limit])).map(toUser); },
    async countUsers() { return Number((await one("SELECT COUNT(*) AS n FROM users"))?.n ?? 0); },
    async createSession(s) { await run("INSERT INTO sessions (token, user_id, expires) VALUES (?,?,?)", [s.token, s.userId, s.expires]); },
    async getSession(token) { const r = await one("SELECT * FROM sessions WHERE token = ?", [token]); return r ? { token: String(r.token), userId: String(r.user_id), expires: Number(r.expires) } : null; },
    async deleteSession(token) { await run("DELETE FROM sessions WHERE token = ?", [token]); },
    async deleteSessionsForUser(userId) { await run("DELETE FROM sessions WHERE user_id = ?", [userId]); },
    async getSetting(key) { const r = await one("SELECT value FROM settings WHERE key = ?", [key]); return r ? String(r.value) : null; },
    async setSetting(key, value) { await run("DELETE FROM settings WHERE key = ?", [key]); await run("INSERT INTO settings (key, value) VALUES (?,?)", [key, value]); },
    async addUsage(userId, day, requests, i, o) { await run(upsertUsage, [userId, day, requests, i, o]); },
    async getUsage(userId, day) { return toUsage(await one("SELECT * FROM usage WHERE user_id = ? AND day = ?", [userId, day])); },
    async usageByDay(days) { return (await all("SELECT day, SUM(requests) AS requests, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens FROM usage WHERE day >= ? GROUP BY day ORDER BY day DESC", [dayCutoff(days)])).map(toUsage); },
    async setVerification(id, code, expires, verified) { await run("UPDATE users SET verify_code = ?, verify_expires = ?" + (verified === undefined ? "" : ", email_verified = ?") + " WHERE id = ?", verified === undefined ? [code, expires, id] : [code, expires, verified, id]); },
    async createPayment(p) { await run("INSERT INTO payments (id, user_id, email, plan, method, amount, currency, txn_id, sender, status, note, created_at, reviewed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", [p.id, p.userId, p.email, p.plan, p.method, p.amount, p.currency, p.txnId, p.sender, p.status, p.note, p.createdAt, p.reviewedAt]); },
    async listPayments({ userId, status, limit = 200 }) { const w: string[] = []; const v: unknown[] = []; if (userId) { w.push("user_id = ?"); v.push(userId); } if (status) { w.push("status = ?"); v.push(status); } return (await all(`SELECT * FROM payments${w.length ? " WHERE " + w.join(" AND ") : ""} ORDER BY created_at DESC LIMIT ?`, [...v, limit])).map(toPayment); },
    async updatePayment(id, patch) { const cols: string[] = []; const vals: unknown[] = []; const map: Record<string, string> = { status: "status", note: "note", reviewedAt: "reviewed_at" }; for (const [k, val] of Object.entries(patch)) if (k in map && val !== undefined) { cols.push(`${map[k]} = ?`); vals.push(val); } if (cols.length) await run(`UPDATE payments SET ${cols.join(", ")} WHERE id = ?`, [...vals, id]); },
    async getPayment(id) { const r = await one("SELECT * FROM payments WHERE id = ?", [id]); return r ? toPayment(r) : null; },
    async createTicket(t) { await run("INSERT INTO tickets (id, user_id, email, subject, message, status, reply, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)", [t.id, t.userId, t.email, t.subject, t.message, t.status, t.reply, t.createdAt, t.updatedAt]); },
    async listTickets({ userId, status, limit = 200 }) { const w: string[] = []; const v: unknown[] = []; if (userId) { w.push("user_id = ?"); v.push(userId); } if (status) { w.push("status = ?"); v.push(status); } return (await all(`SELECT * FROM tickets${w.length ? " WHERE " + w.join(" AND ") : ""} ORDER BY created_at DESC LIMIT ?`, [...v, limit])).map(toTicket); },
    async updateTicket(id, patch) { const cols: string[] = []; const vals: unknown[] = []; const map: Record<string, string> = { status: "status", reply: "reply", updatedAt: "updated_at" }; for (const [k, val] of Object.entries(patch)) if (k in map && val !== undefined) { cols.push(`${map[k]} = ?`); vals.push(val); } if (cols.length) await run(`UPDATE tickets SET ${cols.join(", ")} WHERE id = ?`, [...vals, id]); },
    async usageByUser(days, limit = 50) { return (await all("SELECT u.user_id, us.email, SUM(u.requests) AS requests, SUM(u.input_tokens) AS input_tokens, SUM(u.output_tokens) AS output_tokens FROM usage u JOIN users us ON us.id = u.user_id WHERE u.day >= ? GROUP BY u.user_id, us.email ORDER BY requests DESC LIMIT ?", [dayCutoff(days), limit])).map((r) => ({ ...toUsage(r), userId: String(r.user_id), email: String(r.email) })); },
  };
}

async function sqliteDB(): Promise<DB> {
  const { DatabaseSync } = await import("node:sqlite");
  const dir = process.env.CIVIL_AI_USER_DATA || path.join(os.homedir(), ".civil-ai");
  fs.mkdirSync(dir, { recursive: true });
  const file = process.env.DATABASE_PATH || path.join(dir, "civil-ai.sqlite");
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  const norm = (p?: unknown[]) => (p ?? []).map((v) => (v === undefined ? null : v)) as never[];
  return makeDB(async (sql, p) => { db.prepare(sql).run(...norm(p)); }, async (sql, p) => db.prepare(sql).all(...norm(p)) as Row[], "INTEGER",
    "INSERT INTO usage (user_id, day, requests, input_tokens, output_tokens) VALUES (?,?,?,?,?) ON CONFLICT(user_id, day) DO UPDATE SET requests = requests + excluded.requests, input_tokens = input_tokens + excluded.input_tokens, output_tokens = output_tokens + excluded.output_tokens");
}

async function postgresDB(url: string): Promise<DB> {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false } });
  const pgify = (sql: string) => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); };
  return makeDB(async (sql, p) => { await pool.query(pgify(sql), p ?? []); }, async (sql, p) => (await pool.query(pgify(sql), p ?? [])).rows as Row[], "BIGINT",
    "INSERT INTO usage (user_id, day, requests, input_tokens, output_tokens) VALUES (?,?,?,?,?) ON CONFLICT (user_id, day) DO UPDATE SET requests = usage.requests + EXCLUDED.requests, input_tokens = usage.input_tokens + EXCLUDED.input_tokens, output_tokens = usage.output_tokens + EXCLUDED.output_tokens");
}

let dbPromise: Promise<DB> | null = null;
export function getDB(): Promise<DB> {
  if (!dbPromise) {
    dbPromise = (process.env.DATABASE_URL ? postgresDB(process.env.DATABASE_URL) : sqliteDB()).then(async (d) => { await d.init(); return d; });
  }
  return dbPromise;
}
