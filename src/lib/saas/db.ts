/** Minimal repository over SQLite (node:sqlite, zero-config; desktop/VPS) or Postgres (DATABASE_URL; Vercel + Supabase/Neon). */
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

export type Role = "superadmin" | "admin" | "support" | "user";
export const ROLES: Role[] = ["superadmin", "admin", "support", "user"];
export const isStaff = (r: Role) => r !== "user";

export interface User { id: string; email: string; name: string; passwordHash: string; role: Role; plan: string; planExpires: number | null; createdAt: number; disabled: number; emailVerified: number; verifyCode: string | null; verifyExpires: number | null }
export interface Payment { id: string; userId: string; email: string; plan: string; method: string; amount: number; currency: string; txnId: string; sender: string; status: "pending" | "approved" | "rejected"; note: string; createdAt: number; reviewedAt: number | null; seats: number }
export interface Team { id: string; name: string; ownerId: string; plan: string; seats: number; expires: number | null; createdAt: number }
export interface Share { id: string; userId: string; title: string; size: number; data: string; createdAt: number; expiresAt: number; views: number }
export interface Save { id: string; userId: string; kind: "chat" | "drawing"; title: string; size: number; data: string /* base64 gzip json */; createdAt: number; updatedAt: number }
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
  createTeam(t: Team): Promise<void>;
  updateTeam(id: string, patch: Partial<Pick<Team, "name" | "plan" | "seats" | "expires" | "ownerId">>): Promise<void>;
  getTeam(id: string): Promise<Team | null>;
  getTeamByOwner(ownerId: string): Promise<Team | null>;
  getTeamForUser(userId: string): Promise<Team | null>;
  listTeams(): Promise<Team[]>;
  addTeamMember(teamId: string, userId: string): Promise<void>;
  removeTeamMember(teamId: string, userId: string): Promise<void>;
  listTeamMembers(teamId: string): Promise<User[]>;
  deleteTeam(id: string): Promise<void>;
  upsertSave(sv: Save): Promise<void>;
  listSaves(userId: string): Promise<Omit<Save, "data">[]>;
  getSave(userId: string, id: string): Promise<Save | null>;
  deleteSave(userId: string, id: string): Promise<void>;
  savesUsage(userId: string): Promise<{ bytes: number; count: number }>;
  savesTotal(): Promise<{ bytes: number; count: number; users: number }>;
  createShare(sh: Share): Promise<void>;
  getShare(id: string): Promise<Share | null>;
  listShares(userId: string): Promise<Omit<Share, "data">[]>;
  deleteShare(userId: string, id: string): Promise<void>;
  bumpShareViews(id: string): Promise<void>;
  purgeExpiredShares(): Promise<void>;
}

const SCHEMA = (big: string) => [
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL DEFAULT '', password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', plan TEXT NOT NULL DEFAULT 'free', plan_expires ${big}, created_at ${big} NOT NULL, disabled INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires ${big} NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS usage (user_id TEXT NOT NULL, day TEXT NOT NULL, requests INTEGER NOT NULL DEFAULT 0, input_tokens ${big} NOT NULL DEFAULT 0, output_tokens ${big} NOT NULL DEFAULT 0, PRIMARY KEY (user_id, day))`,
  `CREATE TABLE IF NOT EXISTS payments (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, email TEXT NOT NULL, plan TEXT NOT NULL, method TEXT NOT NULL, amount REAL NOT NULL, currency TEXT NOT NULL, txn_id TEXT NOT NULL, sender TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', note TEXT NOT NULL DEFAULT '', created_at ${big} NOT NULL, reviewed_at ${big})`,
  `CREATE TABLE IF NOT EXISTS teams (id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_id TEXT NOT NULL, plan TEXT NOT NULL, seats INTEGER NOT NULL DEFAULT 3, expires ${big}, created_at ${big} NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS team_members (team_id TEXT NOT NULL, user_id TEXT NOT NULL, added_at ${big} NOT NULL, PRIMARY KEY (team_id, user_id))`,
  `CREATE TABLE IF NOT EXISTS shares (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL, size INTEGER NOT NULL, data TEXT NOT NULL, created_at ${big} NOT NULL, expires_at ${big} NOT NULL, views INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS saves (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, size INTEGER NOT NULL, data TEXT NOT NULL, created_at ${big} NOT NULL, updated_at ${big} NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS saves_user ON saves (user_id, updated_at)`,
  `CREATE TABLE IF NOT EXISTS tickets (id TEXT PRIMARY KEY, user_id TEXT, email TEXT NOT NULL, subject TEXT NOT NULL, message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', reply TEXT NOT NULL DEFAULT '', created_at ${big} NOT NULL, updated_at ${big} NOT NULL)`,
];
/** Additive migrations (ignored when the column already exists). */
const MIGRATIONS = (big: string) => [
  `ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE users ADD COLUMN verify_code TEXT`,
  `ALTER TABLE users ADD COLUMN verify_expires ${big}`,
  `ALTER TABLE payments ADD COLUMN seats INTEGER NOT NULL DEFAULT 1`,
];

type Row = Record<string, unknown>;
const toUser = (r: Row): User => ({ id: String(r.id), email: String(r.email), name: String(r.name ?? ""), passwordHash: String(r.password_hash), role: (ROLES as string[]).includes(String(r.role)) ? (r.role as Role) : "user", plan: String(r.plan), planExpires: r.plan_expires == null ? null : Number(r.plan_expires), createdAt: Number(r.created_at), disabled: Number(r.disabled ?? 0), emailVerified: Number(r.email_verified ?? 0), verifyCode: r.verify_code == null ? null : String(r.verify_code), verifyExpires: r.verify_expires == null ? null : Number(r.verify_expires) });
const toPayment = (r: Row): Payment => ({ id: String(r.id), userId: String(r.user_id), email: String(r.email), plan: String(r.plan), method: String(r.method), amount: Number(r.amount), currency: String(r.currency), txnId: String(r.txn_id), sender: String(r.sender ?? ""), status: r.status as Payment["status"], note: String(r.note ?? ""), createdAt: Number(r.created_at), reviewedAt: r.reviewed_at == null ? null : Number(r.reviewed_at), seats: Number(r.seats ?? 1) });
const toTeam = (r: Row): Team => ({ id: String(r.id), name: String(r.name), ownerId: String(r.owner_id), plan: String(r.plan), seats: Number(r.seats), expires: r.expires == null ? null : Number(r.expires), createdAt: Number(r.created_at) });
const toShare = (r: Row): Share => ({ id: String(r.id), userId: String(r.user_id), title: String(r.title), size: Number(r.size), data: String(r.data ?? ""), createdAt: Number(r.created_at), expiresAt: Number(r.expires_at), views: Number(r.views ?? 0) });
const toSave = (r: Row): Save => ({ id: String(r.id), userId: String(r.user_id), kind: r.kind === "drawing" ? "drawing" : "chat", title: String(r.title), size: Number(r.size), data: String(r.data ?? ""), createdAt: Number(r.created_at), updatedAt: Number(r.updated_at) });
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
    async deleteUser(id) { await run("DELETE FROM sessions WHERE user_id = ?", [id]); await run("DELETE FROM saves WHERE user_id = ?", [id]); await run("DELETE FROM shares WHERE user_id = ?", [id]); await run("DELETE FROM team_members WHERE user_id = ?", [id]); await run("DELETE FROM users WHERE id = ?", [id]); },
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
    async createPayment(p) { await run("INSERT INTO payments (id, user_id, email, plan, method, amount, currency, txn_id, sender, status, note, created_at, reviewed_at, seats) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [p.id, p.userId, p.email, p.plan, p.method, p.amount, p.currency, p.txnId, p.sender, p.status, p.note, p.createdAt, p.reviewedAt, p.seats ?? 1]); },
    async listPayments({ userId, status, limit = 200 }) { const w: string[] = []; const v: unknown[] = []; if (userId) { w.push("user_id = ?"); v.push(userId); } if (status) { w.push("status = ?"); v.push(status); } return (await all(`SELECT * FROM payments${w.length ? " WHERE " + w.join(" AND ") : ""} ORDER BY created_at DESC LIMIT ?`, [...v, limit])).map(toPayment); },
    async updatePayment(id, patch) { const cols: string[] = []; const vals: unknown[] = []; const map: Record<string, string> = { status: "status", note: "note", reviewedAt: "reviewed_at" }; for (const [k, val] of Object.entries(patch)) if (k in map && val !== undefined) { cols.push(`${map[k]} = ?`); vals.push(val); } if (cols.length) await run(`UPDATE payments SET ${cols.join(", ")} WHERE id = ?`, [...vals, id]); },
    async getPayment(id) { const r = await one("SELECT * FROM payments WHERE id = ?", [id]); return r ? toPayment(r) : null; },
    async createTicket(t) { await run("INSERT INTO tickets (id, user_id, email, subject, message, status, reply, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)", [t.id, t.userId, t.email, t.subject, t.message, t.status, t.reply, t.createdAt, t.updatedAt]); },
    async listTickets({ userId, status, limit = 200 }) { const w: string[] = []; const v: unknown[] = []; if (userId) { w.push("user_id = ?"); v.push(userId); } if (status) { w.push("status = ?"); v.push(status); } return (await all(`SELECT * FROM tickets${w.length ? " WHERE " + w.join(" AND ") : ""} ORDER BY created_at DESC LIMIT ?`, [...v, limit])).map(toTicket); },
    async updateTicket(id, patch) { const cols: string[] = []; const vals: unknown[] = []; const map: Record<string, string> = { status: "status", reply: "reply", updatedAt: "updated_at" }; for (const [k, val] of Object.entries(patch)) if (k in map && val !== undefined) { cols.push(`${map[k]} = ?`); vals.push(val); } if (cols.length) await run(`UPDATE tickets SET ${cols.join(", ")} WHERE id = ?`, [...vals, id]); },
    async createTeam(t) { await run("INSERT INTO teams (id, name, owner_id, plan, seats, expires, created_at) VALUES (?,?,?,?,?,?,?)", [t.id, t.name, t.ownerId, t.plan, t.seats, t.expires, t.createdAt]); await run("INSERT INTO team_members (team_id, user_id, added_at) VALUES (?,?,?)", [t.id, t.ownerId, t.createdAt]); },
    async updateTeam(id, patch) { const cols: string[] = []; const vals: unknown[] = []; const map: Record<string, string> = { name: "name", plan: "plan", seats: "seats", expires: "expires", ownerId: "owner_id" }; for (const [k, v] of Object.entries(patch)) if (k in map && v !== undefined) { cols.push(`${map[k]} = ?`); vals.push(v); } if (cols.length) await run(`UPDATE teams SET ${cols.join(", ")} WHERE id = ?`, [...vals, id]); },
    async getTeam(id) { const r = await one("SELECT * FROM teams WHERE id = ?", [id]); return r ? toTeam(r) : null; },
    async getTeamByOwner(ownerId) { const r = await one("SELECT * FROM teams WHERE owner_id = ?", [ownerId]); return r ? toTeam(r) : null; },
    async getTeamForUser(userId) { const r = await one("SELECT t.* FROM teams t JOIN team_members m ON m.team_id = t.id WHERE m.user_id = ? ORDER BY t.expires DESC LIMIT 1", [userId]); return r ? toTeam(r) : null; },
    async listTeams() { return (await all("SELECT * FROM teams ORDER BY created_at DESC LIMIT 500")).map(toTeam); },
    async addTeamMember(teamId, userId) { await run("DELETE FROM team_members WHERE team_id = ? AND user_id = ?", [teamId, userId]); await run("INSERT INTO team_members (team_id, user_id, added_at) VALUES (?,?,?)", [teamId, userId, Date.now()]); },
    async removeTeamMember(teamId, userId) { await run("DELETE FROM team_members WHERE team_id = ? AND user_id = ?", [teamId, userId]); },
    async listTeamMembers(teamId) { return (await all("SELECT u.* FROM users u JOIN team_members m ON m.user_id = u.id WHERE m.team_id = ? ORDER BY m.added_at", [teamId])).map(toUser); },
    async deleteTeam(id) { await run("DELETE FROM team_members WHERE team_id = ?", [id]); await run("DELETE FROM teams WHERE id = ?", [id]); },
    async upsertSave(sv) { await run("DELETE FROM saves WHERE id = ? AND user_id = ?", [sv.id, sv.userId]); await run("INSERT INTO saves (id, user_id, kind, title, size, data, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)", [sv.id, sv.userId, sv.kind, sv.title, sv.size, sv.data, sv.createdAt, sv.updatedAt]); },
    async listSaves(userId) { return (await all("SELECT id, user_id, kind, title, size, created_at, updated_at FROM saves WHERE user_id = ? ORDER BY updated_at DESC LIMIT 2000", [userId])).map((r) => { const { data: _d, ...rest } = toSave({ ...r, data: "" }); void _d; return rest; }); },
    async getSave(userId, id) { const r = await one("SELECT * FROM saves WHERE id = ? AND user_id = ?", [id, userId]); return r ? toSave(r) : null; },
    async deleteSave(userId, id) { await run("DELETE FROM saves WHERE id = ? AND user_id = ?", [id, userId]); },
    async savesUsage(userId) { const r = await one("SELECT COALESCE(SUM(size),0) AS bytes, COUNT(*) AS n FROM saves WHERE user_id = ?", [userId]); return { bytes: Number(r?.bytes ?? 0), count: Number(r?.n ?? 0) }; },
    async createShare(sh) { await run("INSERT INTO shares (id, user_id, title, size, data, created_at, expires_at, views) VALUES (?,?,?,?,?,?,?,?)", [sh.id, sh.userId, sh.title, sh.size, sh.data, sh.createdAt, sh.expiresAt, 0]); },
    async getShare(id) { const r = await one("SELECT * FROM shares WHERE id = ?", [id]); return r ? toShare(r) : null; },
    async listShares(userId) { return (await all("SELECT id, user_id, title, size, created_at, expires_at, views FROM shares WHERE user_id = ? ORDER BY created_at DESC LIMIT 200", [userId])).map((r) => { const { data: _d, ...rest } = toShare({ ...r, data: "" }); void _d; return rest; }); },
    async deleteShare(userId, id) { await run("DELETE FROM shares WHERE id = ? AND user_id = ?", [id, userId]); },
    async bumpShareViews(id) { await run("UPDATE shares SET views = views + 1 WHERE id = ?", [id]); },
    async purgeExpiredShares() { await run("DELETE FROM shares WHERE expires_at < ?", [Date.now()]); },
    async savesTotal() { const r = await one("SELECT COALESCE(SUM(size),0) AS bytes, COUNT(*) AS n, COUNT(DISTINCT user_id) AS u FROM saves"); return { bytes: Number(r?.bytes ?? 0), count: Number(r?.n ?? 0), users: Number(r?.u ?? 0) }; },
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
  // Managed Postgres (Aiven, Neon, Supabase, Render) uses TLS; newer `pg` versions treat sslmode=require in the URL as strict
  // verification, which fails on provider-issued CAs. We strip sslmode from the URL and control TLS here:
  // DATABASE_CA_CERT (PEM text) → strict verification against that CA; otherwise encrypted but not CA-verified.
  const u = new URL(url);
  const local = /localhost|127\.0\.0\.1/.test(u.hostname);
  const wantsSsl = !local && u.searchParams.get("sslmode") !== "disable";
  u.searchParams.delete("sslmode");
  const ca = process.env.DATABASE_CA_CERT;
  const pool = new Pool({ connectionString: u.toString(), ssl: wantsSsl ? (ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false }) : undefined, max: 5, idleTimeoutMillis: 30000 });
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
