/** Cloud backups for paid plans: text-only chats and drawing geometry, gzip-compressed, quota-limited per plan. */
import { gzipSync, gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { getDB, type User, type Save } from "./db";
import { planFor } from "./service";

export interface SaveInput { id?: string; kind: "chat" | "drawing"; title: string; payload: unknown }

/** Strip anything heavy (base64 images, tool SVG previews) so chats stay small. */
function sanitize(kind: SaveInput["kind"], payload: unknown): unknown {
  if (kind !== "chat" || !payload || typeof payload !== "object") return payload;
  const conv = payload as { messages?: { parts?: { type: string; data?: string }[]; toolOutputs?: Record<string, { display?: { kind: string; svg?: string } }> }[] };
  return { ...conv, messages: (conv.messages ?? []).map((m) => ({ ...m, parts: (m.parts ?? []).map((p) => (p.type === "image" ? { type: "text", text: "[image not backed up]" } : p)), toolOutputs: m.toolOutputs && Object.fromEntries(Object.entries(m.toolOutputs).map(([k, v]) => [k, v.display?.kind === "drawing" ? { ...v, display: { ...v.display, svg: "" } } : v])) })) };
}

export async function quotaFor(user: User): Promise<{ limitBytes: number; maxItems: number; used: { bytes: number; count: number } }> {
  const plan = await planFor(user);
  const used = await (await getDB()).savesUsage(user.id);
  return { limitBytes: (plan.cloudStorageMB ?? 0) * 1024 * 1024, maxItems: plan.maxSavedItems ?? 0, used };
}

/** Global safety cap so backups never exhaust a free database tier (Neon 0.5 GB). Raise CLOUD_TOTAL_CAP_MB when you move to a paid tier. */
export const CLOUD_TOTAL_CAP_MB = Number(process.env.CLOUD_TOTAL_CAP_MB ?? 350); // Neon-safe default; set 8000 on CockroachDB Cloud (10 GiB free)

export async function putSave(user: User, input: SaveInput): Promise<{ id: string; size: number }> {
  const q = await quotaFor(user);
  if (q.limitBytes <= 0) throw new Error("Cloud backup is included in paid plans. Upgrade to save chats and designs to your account.");
  const json = JSON.stringify(sanitize(input.kind, input.payload));
  const data = gzipSync(Buffer.from(json)).toString("base64");
  const size = data.length;
  if (size > 4 * 1024 * 1024) throw new Error("This item is too large to back up (max 4 MB compressed)");
  const db = await getDB();
  const id = input.id && /^[a-z0-9_-]{6,64}$/i.test(input.id) ? input.id : createHash("sha1").update(`${user.id}:${input.kind}:${input.title}:${Date.now()}`).digest("hex").slice(0, 24);
  const existing = await db.getSave(user.id, id);
  const total = await db.savesTotal();
  if (total.bytes + size - (existing?.size ?? 0) > CLOUD_TOTAL_CAP_MB * 1048576) throw new Error("Cloud backup storage is temporarily full on the service. Your chats stay on this device; please try again later or export them from the sidebar.");
  const newBytes = q.used.bytes - (existing?.size ?? 0) + size;
  const newCount = q.used.count + (existing ? 0 : 1);
  if (newBytes > q.limitBytes) throw new Error(`Cloud storage full (${(q.limitBytes / 1048576).toFixed(0)} MB on your plan). Delete some saved items or upgrade.`);
  if (newCount > q.maxItems) throw new Error(`Item limit reached (${q.maxItems} on your plan). Delete some saved items or upgrade.`);
  const sv: Save = { id, userId: user.id, kind: input.kind, title: input.title.slice(0, 120) || "(untitled)", size, data, createdAt: existing?.createdAt ?? Date.now(), updatedAt: Date.now() };
  await db.upsertSave(sv);
  return { id, size };
}

export async function readSave(user: User, id: string): Promise<{ meta: Omit<Save, "data">; payload: unknown } | null> {
  const sv = await (await getDB()).getSave(user.id, id);
  if (!sv) return null;
  const { data, ...meta } = sv;
  return { meta, payload: JSON.parse(gunzipSync(Buffer.from(data, "base64")).toString()) };
}

export const gravatar = (email: string) => `https://www.gravatar.com/avatar/${createHash("md5").update(email.trim().toLowerCase()).digest("hex")}?d=identicon&s=80`;
