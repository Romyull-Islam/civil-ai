/**
 * Desktop ↔ cloud bridge. The downloadable app runs local models itself and, when the user picks a cloud model,
 * forwards the request to your hosted Civil AI backend (SaaS mode) with the user's session token. Keys never leave the server.
 */
import { getDB } from "./db";

export interface CloudLink { backendUrl: string; token: string; email: string; plan?: string; /** cached plan entitlement for offline use */ localAI?: boolean; checkedAt?: number }

export async function getCloudLink(): Promise<CloudLink | null> {
  const raw = await (await getDB()).getSetting("cloud");
  if (!raw) return null;
  try { return JSON.parse(raw) as CloudLink; } catch { return null; }
}
export async function setCloudLink(link: CloudLink | null) { await (await getDB()).setSetting("cloud", link ? JSON.stringify(link) : ""); }

const clean = (u: string) => u.trim().replace(/\/+$/, "");

export async function cloudLogin(backendUrl: string, email: string, password: string): Promise<CloudLink> {
  const url = clean(backendUrl);
  const r = await fetch(`${url}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  const j = (await r.json()) as { token?: string; user?: { email: string; plan: string }; error?: string };
  if (!r.ok || !j.token) throw new Error(j.error ?? `Login failed (${r.status})`);
  const link = { backendUrl: url, token: j.token, email: j.user?.email ?? email, plan: j.user?.plan };
  await setCloudLink(link);
  return link;
}

export async function cloudMe(link: CloudLink) {
  const r = await fetch(`${link.backendUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${link.token}` } });
  const me = (await r.json()) as { user: unknown; plan?: { id?: string; name?: string; localAI?: boolean }; allowedModels?: { provider: string; model: string }[]; usage?: unknown };
  if (me.user) await setCloudLink({ ...link, plan: me.plan?.id, localAI: !!me.plan?.localAI, checkedAt: Date.now() }); // refresh cached entitlement
  return me;
}

/** May this installation run the built-in local model? byok: always. desktop: linked plan with localAI (cached ≤ 14 days) or CIVIL_AI_LOCAL_AI_FREE=1. */
export async function localAIAllowed(mode: string): Promise<{ allowed: boolean; reason?: string }> {
  if (mode === "byok" || process.env.CIVIL_AI_LOCAL_AI_FREE === "1") return { allowed: true };
  const link = await getCloudLink();
  if (!link) return { allowed: false, reason: "Sign in to your Civil AI account (Settings → cloud account). The offline model is included in Pro and Business plans." };
  if (link.checkedAt && Date.now() - link.checkedAt > 14 * 86400000) { try { await cloudMe(link); } catch { /* offline: keep cached */ } }
  const fresh = (await getCloudLink()) ?? link;
  if (!fresh.localAI) return { allowed: false, reason: `Your plan (${fresh.plan ?? "free"}) does not include the offline model. Upgrade to Pro or Business.` };
  return { allowed: true };
}

/** Stream a chat request through the cloud backend. */
export async function cloudChat(link: CloudLink, body: unknown, signal?: AbortSignal): Promise<Response> {
  return fetch(`${link.backendUrl}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${link.token}` }, body: JSON.stringify(body), signal });
}
