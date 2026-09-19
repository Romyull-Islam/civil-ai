/** Public read-only share links for conversations: text + results + drawing geometry, images removed, gzip-compressed, expiring. */
import { gzipSync, gunzipSync } from "node:zlib";
import { randomBytes } from "node:crypto";
import { getDB, type User } from "./db";

export const SHARE_DAYS = Number(process.env.SHARE_DAYS ?? 30);
export const SHARE_MAX_ACTIVE = Number(process.env.SHARE_MAX_ACTIVE ?? 20);
const MAX_BYTES = 1024 * 1024;

type Part = { type: string; data?: string; text?: string; name?: string };
type Msg = { role: string; parts?: Part[]; toolOutputs?: Record<string, { display?: { kind: string; svg?: string } }>; meta?: Record<string, unknown> };

/** Keep what a reader needs; drop images, cached SVG, usage/provider details. */
export function sanitizeForShare(conv: { title?: string; messages?: Msg[] }) {
  return {
    title: String(conv.title ?? "Shared conversation").slice(0, 120),
    messages: (conv.messages ?? []).filter((m) => m.role === "user" || m.role === "assistant").map((m) => ({
      role: m.role,
      parts: (m.parts ?? []).map((p) => (p.type === "image" ? { type: "text", text: "[image not included]" } : p.type === "document" ? { type: "text", text: `[document not included: ${p.name}]` } : p)),
      toolOutputs: m.toolOutputs && Object.fromEntries(Object.entries(m.toolOutputs).map(([k, v]) => [k, v.display?.kind === "drawing" ? { ...v, display: { ...v.display, svg: "" } } : v])),
    })),
  };
}

export async function createShare(user: User, conv: { title?: string; messages?: Msg[] }): Promise<{ id: string; expiresAt: number }> {
  const db = await getDB();
  await db.purgeExpiredShares();
  const mine = await db.listShares(user.id);
  if (mine.length >= SHARE_MAX_ACTIVE) throw new Error(`You already have ${SHARE_MAX_ACTIVE} active share links. Stop sharing an older one first (Account → Shared links).`);
  const clean = sanitizeForShare(conv);
  if (!clean.messages.length) throw new Error("Nothing to share yet");
  const data = gzipSync(Buffer.from(JSON.stringify(clean))).toString("base64");
  if (data.length > MAX_BYTES) throw new Error("This conversation is too long to share as a link. Download it instead.");
  const id = randomBytes(12).toString("base64url");
  const expiresAt = Date.now() + SHARE_DAYS * 86400000;
  await db.createShare({ id, userId: user.id, title: clean.title, size: data.length, data, createdAt: Date.now(), expiresAt, views: 0 });
  return { id, expiresAt };
}

export async function readShare(id: string): Promise<{ title: string; createdAt: number; expiresAt: number; payload: unknown } | null> {
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(id)) return null;
  const db = await getDB();
  const sh = await db.getShare(id);
  if (!sh || sh.expiresAt < Date.now()) return null;
  db.bumpShareViews(id).catch(() => {});
  return { title: sh.title, createdAt: sh.createdAt, expiresAt: sh.expiresAt, payload: JSON.parse(gunzipSync(Buffer.from(sh.data, "base64")).toString()) };
}
