import { getDB, isStaff, type User, type Role, type Team } from "./db";
import { hashPassword, verifyPassword, newId, newToken, encrypt, decrypt } from "./crypto";
import { DEFAULT_PLANS, planModels, withCreditDefaults, type Plan } from "./plans";
import { creditsFor } from "./credits";
import { isUsable } from "@/lib/ai/quality";
import { PROVIDERS, type KeyBag } from "@/lib/ai/registry";
import { sendEmail, emailConfigured } from "./email";
import { getSite } from "./site";
import type { Payment, Ticket } from "./db";

export const SESSION_COOKIE = "civil_session";
const SESSION_DAYS = 30;

export type PublicUser = Omit<User, "passwordHash" | "verifyCode" | "verifyExpires">;
export const publicUser = (u: User): PublicUser => { const { passwordHash: _a, verifyCode: _b, verifyExpires: _c, ...rest } = u; void _a; void _b; void _c; return rest; };

export function parseCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) { const [k, ...v] = part.trim().split("="); if (k === name) return decodeURIComponent(v.join("=")); }
  return null;
}

export async function getSessionUser(req: Request): Promise<User | null> {
  const auth = req.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : parseCookie(req.headers.get("cookie"), SESSION_COOKIE);
  if (!token) return null;
  const db = await getDB();
  const s = await db.getSession(token);
  if (!s || s.expires < Date.now()) { if (s) await db.deleteSession(token); return null; }
  const u = await db.getUserById(s.userId);
  return u && !u.disabled ? u : null;
}

export function sessionCookie(token: string, maxAgeSec = SESSION_DAYS * 86400): string {
  const secure = process.env.NODE_ENV === "production" && !process.env.CIVIL_AI_DESKTOP ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`;
}

const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export async function signup(email: string, password: string, name = ""): Promise<{ user: User; token: string }> {
  if (!validEmail(email)) throw new Error("Enter a valid email address");
  if (password.length < 8) throw new Error("Password must be at least 8 characters");
  const db = await getDB();
  if (await db.getUserByEmail(email)) throw new Error("An account with this email already exists");
  const admins = (process.env.ADMIN_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const first = (await db.countUsers()) === 0;
  const role: Role = first || admins.includes(email.toLowerCase()) ? "superadmin" : "user";
  const needVerify = await verificationRequired();
  const code = needVerify ? String(Math.floor(100000 + Math.random() * 900000)) : null;
  const user: User = { id: newId(), email: email.toLowerCase(), name: name.trim().slice(0, 80), passwordHash: hashPassword(password), role, plan: "free", planExpires: null, createdAt: Date.now(), disabled: 0, emailVerified: needVerify && role === "user" ? 0 : 1, verifyCode: code, verifyExpires: code ? Date.now() + 30 * 60000 : null };
  await db.createUser(user);
  if (code && !user.emailVerified) await sendVerificationEmail(user, code);
  const token = newToken();
  await db.createSession({ token, userId: user.id, expires: Date.now() + SESSION_DAYS * 86400000 });
  return { user, token };
}

/** Email verification policy: "auto" requires it only when an email API key is configured (otherwise codes could not be delivered). */
export async function verificationRequired(): Promise<boolean> {
  const site = await getSite();
  if (site.requireEmailVerification === "never") return false;
  if (site.requireEmailVerification === "always") return true;
  return emailConfigured();
}
async function sendVerificationEmail(user: User, code: string) {
  const site = await getSite();
  await sendEmail(user.email, `${site.appName}: your verification code ${code}`, `Hello ${user.name || ""}

Your ${site.appName} verification code is: ${code}
It expires in 30 minutes.

If you did not create an account, ignore this email.`);
}
export async function resendVerification(user: User) {
  if (user.emailVerified) return;
  const code = String(Math.floor(100000 + Math.random() * 900000));
  await (await getDB()).setVerification(user.id, code, Date.now() + 30 * 60000);
  await sendVerificationEmail(user, code);
}
export async function verifyEmail(user: User, code: string): Promise<boolean> {
  if (user.emailVerified) return true;
  const fresh = await (await getDB()).getUserById(user.id);
  if (!fresh?.verifyCode || fresh.verifyCode !== code.trim() || (fresh.verifyExpires ?? 0) < Date.now()) return false;
  await (await getDB()).setVerification(user.id, null, null, 1);
  return true;
}

// ---------- manual payments (bKash / Nagad / Rocket / QR / bank) ----------
export async function submitPayment(user: User, input: { plan: string; method: string; amount: number; currency: string; txnId: string; sender: string; seats?: number }): Promise<Payment> {
  const plans = await getPlans();
  const plan = plans.find((p) => p.id === input.plan);
  if (!plan || plan.priceMonthly <= 0) throw new Error("Choose a paid plan");
  if (!input.txnId?.trim()) throw new Error("Transaction ID is required");
  const seats = plan.perSeat ? Math.max(plan.minSeats ?? 1, Math.floor(Number(input.seats) || 0)) : 1;
  const p: Payment = { id: newId(), userId: user.id, email: user.email, plan: plan.id, method: input.method.slice(0, 30), amount: Number(input.amount) || 0, currency: (input.currency || "BDT").slice(0, 8), txnId: input.txnId.trim().slice(0, 64), sender: (input.sender ?? "").trim().slice(0, 40), status: "pending", note: seats > 1 ? `seats=${seats}` : "", createdAt: Date.now(), reviewedAt: null, seats };
  await (await getDB()).createPayment(p);
  return p;
}
export async function reviewPayment(id: string, status: "approved" | "rejected", note = ""): Promise<Payment | null> {
  const db = await getDB();
  const p = await db.getPayment(id);
  if (!p) return null;
  await db.updatePayment(id, { status, note, reviewedAt: Date.now() });
  if (status === "approved") {
    const r = await activatePlan(p.userId, p.plan, undefined, p.seats);
    if (r) { const site = await getSite(); sendEmail(p.email, `${site.appName}: ${r.plan.name} plan activated`, `Your payment (${p.method} ${p.txnId}) was verified. The ${r.plan.name} plan is active until ${new Date(r.expires).toDateString()}.`).catch(() => {}); }
  }
  return db.getPayment(id);
}

// ---------- support tickets ----------
export async function openTicket(input: { userId: string | null; email: string; subject: string; message: string }): Promise<Ticket> {
  if (!validEmail(input.email)) throw new Error("Valid email required");
  if (!input.subject?.trim() || !input.message?.trim()) throw new Error("Subject and message are required");
  const t: Ticket = { id: newId(), userId: input.userId, email: input.email.toLowerCase(), subject: input.subject.trim().slice(0, 120), message: input.message.trim().slice(0, 4000), status: "open", reply: "", createdAt: Date.now(), updatedAt: Date.now() };
  await (await getDB()).createTicket(t);
  const site = await getSite();
  if (site.supportEmail) sendEmail(site.supportEmail, `[${site.appName} support] ${t.subject}`, `From: ${t.email}

${t.message}`).catch(() => {});
  return t;
}
export async function answerTicket(id: string, reply: string, status: Ticket["status"]) {
  const db = await getDB();
  await db.updateTicket(id, { reply, status, updatedAt: Date.now() });
  const t = (await db.listTickets({ limit: 1000 })).find((x) => x.id === id);
  if (t && reply) { const site = await getSite(); sendEmail(t.email, `Re: ${t.subject}`, `${reply}

${site.appName} support`).catch(() => {}); }
  return t ?? null;
}

export async function login(email: string, password: string, totpCode?: string): Promise<{ user: User; token: string; needsTotp?: boolean }> {
  const db = await getDB();
  const user = await db.getUserByEmail(email);
  if (!user || !verifyPassword(password, user.passwordHash)) throw new Error("Invalid email or password");
  if (user.disabled) throw new Error("This account is disabled");
  const secret = await db.getSetting(`totp:${user.id}`);
  if (secret) {
    if (!totpCode) return { user, token: "", needsTotp: true };
    const { totpVerify } = await import("./security");
    if (!totpVerify(decrypt(secret), totpCode)) throw new Error("Invalid authenticator code");
  }
  const token = newToken();
  await db.createSession({ token, userId: user.id, expires: Date.now() + SESSION_DAYS * 86400000 });
  return { user, token };
}

export async function logout(req: Request) {
  const token = parseCookie(req.headers.get("cookie"), SESSION_COOKIE);
  if (token) (await getDB()).deleteSession(token).catch(() => {});
}

// ---------- plans ----------
export async function getPlans(): Promise<Plan[]> {
  const raw = await (await getDB()).getSetting("plans");
  if (!raw) return DEFAULT_PLANS;
  try { const p = JSON.parse(raw) as Plan[]; return Array.isArray(p) && p.length ? p.map(withCreditDefaults) : DEFAULT_PLANS; } catch { return DEFAULT_PLANS; }
}
export async function setPlans(plans: Plan[]) { await (await getDB()).setSetting("plans", JSON.stringify(plans)); }

export async function planFor(user: User): Promise<Plan> {
  const plans = await getPlans();
  // Team membership grants the team's plan to every member while the team subscription is active (incl. grace).
  const team = await (await getDB()).getTeamForUser(user.id);
  if (team) {
    const tp = plans.find((p) => p.id === team.plan);
    if (tp && (team.expires === null || team.expires + (tp.graceDays ?? 3) * 86400000 > Date.now())) return tp;
  }
  const current = plans.find((p) => p.id === user.plan);
  const grace = (current?.graceDays ?? 3) * 86400000;
  const expired = user.planExpires !== null && user.planExpires + grace < Date.now();
  return plans.find((p) => p.id === (expired ? "free" : user.plan)) ?? plans[0];
}

/** Renewal state for banners/emails. */
export function renewalState(user: User, plan: Plan): { status: "none" | "ok" | "expiring" | "grace" | "expired"; daysLeft: number | null } {
  if (!user.planExpires || plan.priceMonthly === 0) return { status: "none", daysLeft: null };
  const days = (user.planExpires - Date.now()) / 86400000;
  if (days > 7) return { status: "ok", daysLeft: Math.ceil(days) };
  if (days > 0) return { status: "expiring", daysLeft: Math.ceil(days) };
  if (days > -(plan.graceDays ?? 3)) return { status: "grace", daysLeft: Math.ceil(days) };
  return { status: "expired", daysLeft: Math.ceil(days) };
}

/** Activate/extend a plan (used by manual approval and payment webhooks). Extends from the current expiry when still active. */
export async function activatePlan(userId: string, planId: string, days?: number, seats?: number): Promise<{ expires: number; plan: Plan } | null> {
  const db = await getDB();
  const plan = (await getPlans()).find((x) => x.id === planId);
  const user = await db.getUserById(userId);
  if (!plan || !user) return null;
  const base = user.plan === plan.id && user.planExpires && user.planExpires > Date.now() ? user.planExpires : Date.now();
  const expires = base + (days ?? plan.periodDays ?? 30) * 86400000;
  await db.updateUser(user.id, { plan: plan.id, planExpires: expires });
  if (plan.perSeat) {
    // Buyer becomes (or remains) the owner of a team sized by the paid seats.
    const n = Math.max(plan.minSeats ?? 1, seats ?? plan.minSeats ?? 1);
    const team = await db.getTeamByOwner(user.id);
    if (team) await db.updateTeam(team.id, { plan: plan.id, seats: n, expires });
    else await db.createTeam({ id: newId(), name: `${user.name || user.email}'s team`, ownerId: user.id, plan: plan.id, seats: n, expires, createdAt: Date.now() });
  }
  return { expires, plan };
}

// ---------- server-held provider keys (admin) ----------
export async function getServerKeys(): Promise<KeyBag> {
  const db = await getDB();
  const bag: KeyBag = {};
  for (const p of PROVIDERS) {
    const enc = await db.getSetting(`key:${p.id}`);
    const base = await db.getSetting(`baseurl:${p.id}`);
    if (enc || base) bag[p.id] = { apiKey: enc ? decrypt(enc) : undefined, baseUrl: base ?? undefined };
  }
  return bag; // env vars remain the fallback inside resolveProvider()
}
export async function setServerKey(provider: string, apiKey?: string | null, baseUrl?: string | null) {
  const db = await getDB();
  if (apiKey !== undefined) await db.setSetting(`key:${provider}`, apiKey ? encrypt(apiKey) : "");
  if (baseUrl !== undefined) await db.setSetting(`baseurl:${provider}`, baseUrl ?? "");
}
export async function keyStatus(): Promise<Record<string, { set: boolean; fromEnv: boolean; baseUrl?: string }>> {
  const db = await getDB();
  const out: Record<string, { set: boolean; fromEnv: boolean; baseUrl?: string }> = {};
  for (const p of PROVIDERS) {
    const enc = await db.getSetting(`key:${p.id}`);
    out[p.id] = { set: !!enc, fromEnv: !!process.env[p.keyEnv], baseUrl: (await db.getSetting(`baseurl:${p.id}`)) || undefined };
  }
  return out;
}

// ---------- quotas & usage ----------
export const today = () => new Date().toISOString().slice(0, 10);
export interface Allowance { used: number; limit: number; /** epoch ms when this allowance refills; null = session not started */ resetsAt: number | null }
export interface Quota {
  plan: Plan;
  session: Allowance;
  week: Allowance;
  period: Allowance & { start: string };
  /** credits that can still be spent now: the smallest of the three allowances */
  remaining: number;
  /** which allowance is used up (the one that refills last), or null */
  blockedBy: "session" | "week" | "period" | null;
}

const DAY = 86400000;
const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);

/**
 * First day of the current billing period: paid plans run from (expiry − periodDays), so a renewal starts a fresh budget;
 * free plans and plans without an expiry use the calendar month (UTC).
 */
export function periodStartDay(plan: Plan, expires: number | null, now = Date.now()): string {
  const monthStart = new Date(now).toISOString().slice(0, 8) + "01";
  if (!expires || plan.priceMonthly === 0) return monthStart;
  return new Date(Math.min(expires - (plan.periodDays ?? 30) * DAY, now)).toISOString().slice(0, 10);
}

/** End of the billing period that starts on `start` (exclusive, epoch ms). */
export function periodEnd(plan: Plan, start: string, expires: number | null): number {
  if (!expires || plan.priceMonthly === 0) { const d = new Date(dayMs(start)); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); }
  return dayMs(start) + (plan.periodDays ?? 30) * DAY;
}

/** Weeks are counted from the start of the billing period: days 1–7, 8–14, … (the last one may be shorter). */
export function weekWindow(periodStart: string, periodEndMs: number, now = Date.now()): { start: number; end: number } {
  const p0 = dayMs(periodStart);
  const start = p0 + Math.floor(Math.max(0, now - p0) / (7 * DAY)) * 7 * DAY;
  return { start, end: Math.min(start + 7 * DAY, periodEndMs) };
}

const sessionKey = (userId: string) => `usage-session:${userId}`;
/** Start of the user's current usage session, or null when none is running (the next question starts one). */
async function activeSessionStart(userId: string, hours: number, now = Date.now()): Promise<number | null> {
  const v = Number(await (await getDB()).getSetting(sessionKey(userId)));
  return v && now < v + hours * 3600000 ? v : null;
}

export async function quota(user: User, now = Date.now()): Promise<Quota> {
  const plan = await planFor(user);
  const db = await getDB();
  const team = await db.getTeamForUser(user.id);
  const expires = team && team.plan === plan.id ? team.expires : user.planExpires;
  const pStart = periodStartDay(plan, expires, now);
  const pEnd = periodEnd(plan, pStart, expires);
  const week = weekWindow(pStart, pEnd, now);
  const hours = plan.sessionHours ?? 5;
  const sStart = await activeSessionStart(user.id, hours, now);
  const [period, weekUsed, sessionUsed] = await Promise.all([
    db.sumUsage(user.id, pStart),
    db.sumUsageEvents(user.id, week.start),
    sStart ? db.sumUsageEvents(user.id, sStart) : Promise.resolve(0),
  ]);
  const staff = isStaff(user.role);
  const lim = (n: number) => (staff ? Infinity : n);
  const q: Quota = {
    plan,
    session: { used: sessionUsed, limit: lim(plan.sessionCredits), resetsAt: sStart ? sStart + hours * 3600000 : null },
    week: { used: weekUsed, limit: lim(plan.weeklyCredits), resetsAt: week.end },
    period: { used: period.credits, limit: lim(plan.monthlyCredits), resetsAt: pEnd, start: pStart },
    remaining: 0,
    blockedBy: null,
  };
  q.remaining = Math.max(0, Math.min(q.session.limit - q.session.used, q.week.limit - q.week.used, q.period.limit - q.period.used));
  if (q.remaining <= 0) q.blockedBy = q.period.used >= q.period.limit ? "period" : q.week.used >= q.week.limit ? "week" : "session";
  return q;
}

/** Usage summary for the UI (credits rounded to 0.1; staff are unlimited → null limits). */
export function publicUsage(q: Quota) {
  const r = (n: number) => Math.round(n * 10) / 10;
  const a = (x: Allowance) => ({ used: r(x.used), limit: Number.isFinite(x.limit) ? x.limit : null, resetsAt: x.resetsAt });
  const unlimited = !Number.isFinite(q.period.limit);
  return { remaining: unlimited ? null : r(q.remaining), blockedBy: q.blockedBy, session: a(q.session), week: a(q.week), period: { ...a(q.period), start: q.period.start }, sessionHours: q.plan.sessionHours ?? 5 };
}

/** Human time in Bangladesh, e.g. "Tue 23 Sep, 11:40". */
export const bdTime = (ms: number) => new Date(ms).toLocaleString("en-GB", { timeZone: "Asia/Dhaka", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** The message shown when a user has no credits left, naming the limit and when it refills. */
export function limitMessage(q: Quota): string {
  const when = (ms: number | null) => (ms ? bdTime(ms) : "soon");
  if (q.blockedBy === "period") return `You have used this period's ${q.period.limit} AI credits on the ${q.plan.name} plan. They refill on ${when(q.period.resetsAt)} (Bangladesh time), or upgrade for more. Calculators, drawings and the code library stay available.`;
  if (q.blockedBy === "week") return `You have reached this week's limit of ${q.week.limit} AI credits on the ${q.plan.name} plan. It refills on ${when(q.week.resetsAt)} (Bangladesh time); your monthly credits are kept. Calculators, drawings and the code library stay available.`;
  return `You have reached the ${q.session.limit}-credit limit for this ${q.plan.sessionHours ?? 5}-hour session on the ${q.plan.name} plan. A new session starts at ${when(q.session.resetsAt)} (Bangladesh time); your weekly and monthly credits are kept.`;
}

/** Charge one model call: credits by that model's price and real token use (see credits.ts). `newRequest` counts a user question. */
export async function recordUsage(userId: string, provider: string, model: string, inputTokens: number, outputTokens: number, newRequest = false, now = Date.now()) {
  const db = await getDB();
  const credits = creditsFor(provider, model, inputTokens, outputTokens);
  const user = await db.getUserById(userId);
  const hours = user ? ((await planFor(user)).sessionHours ?? 5) : 5;
  if (!(await activeSessionStart(userId, hours, now))) await db.setSetting(sessionKey(userId), String(now));
  await Promise.all([db.addUsage(userId, new Date(now).toISOString().slice(0, 10), newRequest ? 1 : 0, inputTokens, outputTokens, credits), db.addUsageEvent(userId, now, credits)]);
  // Session and weekly windows never look back more than 7 days.
  if (Math.random() < 0.02) db.pruneUsageEvents(now - 8 * DAY).catch(() => {});
}

/** Pick provider/model for a SaaS request: honour the user's choice if the plan allows it, else the plan default. */
export function chooseModel(plan: Plan, requestedProvider?: string, requestedModel?: string): { provider: string; model: string; chain: { provider: string; model: string }[] } {
  // Models that failed the engineering benchmark are never used, even if an admin ticked them (see lib/ai/quality.ts).
  const allowed = planModels(plan).filter((m) => isUsable(m.provider, m.model));
  if (!allowed.length) throw new Error(`No approved AI model is set up for the ${plan.name} plan yet. Please contact support.`);
  const hit = allowed.find((a) => a.provider === requestedProvider && (!requestedModel || a.model === requestedModel));
  const first = hit ?? allowed[0];
  // fallback chain: the chosen one first, then the other allowed models
  const chain = [first, ...allowed.filter((a) => a !== first)];
  return { provider: first.provider, model: first.model, chain };
}

/** Superadmin creates a staff (or user) account directly with a temporary password. */
export async function createAccount(email: string, password: string, role: Role, name = ""): Promise<User> {
  if (!validEmail(email)) throw new Error("Enter a valid email address");
  if (password.length < 8) throw new Error("Password must be at least 8 characters");
  const db = await getDB();
  if (await db.getUserByEmail(email)) throw new Error("An account with this email already exists");
  const user: User = { id: newId(), email: email.toLowerCase(), name: name.trim().slice(0, 80), passwordHash: hashPassword(password), role, plan: "free", planExpires: null, createdAt: Date.now(), disabled: 0, emailVerified: 1, verifyCode: null, verifyExpires: null };
  await db.createUser(user);
  const site = await getSite();
  sendEmail(user.email, `${site.appName}: your ${role} account`, `An account was created for you on ${site.appName}.\nEmail: ${user.email}\nTemporary password: ${password}\nRole: ${role}\n\nPlease sign in and change your password (Account page).`).catch(() => {});
  return user;
}

// ---------- password reset ----------
export async function requestPasswordReset(email: string): Promise<void> {
  const db = await getDB();
  const user = await db.getUserByEmail(email);
  if (!user) return; // do not reveal whether the email exists
  const code = String(Math.floor(100000 + Math.random() * 900000));
  await db.setSetting(`reset:${user.id}`, JSON.stringify({ code, expires: Date.now() + 30 * 60000, attempts: 0 }));
  const site = await getSite();
  await sendEmail(user.email, `${site.appName}: password reset code ${code}`, `Use this code to reset your password: ${code}\nIt expires in 30 minutes. If you did not request this, ignore this email.`);
}
export async function resetPassword(email: string, code: string, newPassword: string): Promise<void> {
  if (newPassword.length < 8) throw new Error("Password must be at least 8 characters");
  const db = await getDB();
  const user = await db.getUserByEmail(email);
  const raw = user ? await db.getSetting(`reset:${user.id}`) : null;
  const rec = raw ? (JSON.parse(raw) as { code: string; expires: number; attempts: number }) : null;
  if (!user || !rec || rec.expires < Date.now()) throw new Error("Invalid or expired code");
  if (rec.attempts >= 5) { await db.setSetting(`reset:${user.id}`, ""); throw new Error("Too many attempts, request a new code"); }
  if (rec.code !== code.trim()) { await db.setSetting(`reset:${user.id}`, JSON.stringify({ ...rec, attempts: rec.attempts + 1 })); throw new Error("Invalid or expired code"); }
  await db.updateUser(user.id, { passwordHash: hashPassword(newPassword) });
  await db.setSetting(`reset:${user.id}`, "");
  await db.deleteSessionsForUser(user.id); // sign out everywhere
}
export async function changePassword(user: User, current: string, next: string): Promise<void> {
  if (!verifyPassword(current, user.passwordHash)) throw new Error("Current password is incorrect");
  if (next.length < 8) throw new Error("New password must be at least 8 characters");
  await (await getDB()).updateUser(user.id, { passwordHash: hashPassword(next) });
}

// ---------- two-factor (TOTP) for staff ----------
export async function totpSetupStart(user: User): Promise<{ secret: string; otpauth: string }> {
  const { newTotpSecret, otpauthUrl } = await import("./security");
  const secret = newTotpSecret();
  await (await getDB()).setSetting(`totp-pending:${user.id}`, encrypt(secret));
  const site = await getSite();
  return { secret, otpauth: otpauthUrl(site.appName, user.email, secret) };
}
export async function totpSetupConfirm(user: User, code: string): Promise<void> {
  const db = await getDB();
  const pending = await db.getSetting(`totp-pending:${user.id}`);
  if (!pending) throw new Error("Start 2FA setup first");
  const { totpVerify } = await import("./security");
  if (!totpVerify(decrypt(pending), code)) throw new Error("Code does not match, check your authenticator app time");
  await db.setSetting(`totp:${user.id}`, pending);
  await db.setSetting(`totp-pending:${user.id}`, "");
}
export async function totpDisable(user: User, password: string): Promise<void> {
  if (!verifyPassword(password, user.passwordHash)) throw new Error("Password incorrect");
  await (await getDB()).setSetting(`totp:${user.id}`, "");
}
export async function totpEnabled(userId: string): Promise<boolean> { return !!(await (await getDB()).getSetting(`totp:${userId}`)); }

// ---------- teams ----------
export async function myTeam(user: User): Promise<{ team: Team; members: PublicUser[]; owner: boolean; plan: Plan | undefined } | null> {
  const db = await getDB();
  const team = (await db.getTeamByOwner(user.id)) ?? (await db.getTeamForUser(user.id));
  if (!team) return null;
  const members = (await db.listTeamMembers(team.id)).map(publicUser);
  return { team, members, owner: team.ownerId === user.id, plan: (await getPlans()).find((p) => p.id === team.plan) };
}
export async function addTeamMember(owner: User, email: string): Promise<void> {
  const db = await getDB();
  const team = await db.getTeamByOwner(owner.id);
  if (!team) throw new Error("You do not own a team");
  const members = await db.listTeamMembers(team.id);
  if (members.length >= team.seats) throw new Error(`All ${team.seats} seats are used, buy more seats to add members`);
  const u = await db.getUserByEmail(email);
  if (!u) throw new Error("No account with that email, ask them to sign up first (free), then add them");
  if (members.some((m) => m.id === u.id)) throw new Error("Already a member");
  await db.addTeamMember(team.id, u.id);
  const site = await getSite();
  sendEmail(u.email, `${site.appName}: you were added to ${team.name}`, `${owner.name || owner.email} added you to their team. Your account now has the ${team.plan} plan features.`).catch(() => {});
}
export async function removeTeamMember(owner: User, userId: string): Promise<void> {
  const db = await getDB();
  const team = await db.getTeamByOwner(owner.id);
  if (!team) throw new Error("You do not own a team");
  if (userId === owner.id) throw new Error("The owner cannot be removed");
  await db.removeTeamMember(team.id, userId);
}
