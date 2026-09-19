"use client";
import { useEffect, useState } from "react";

export interface Allowance { used: number; limit: number | null; resetsAt: number | null }
export interface UsageInfo { remaining: number | null; allowanceRemaining?: number | null; blockedBy: "session" | "week" | "period" | null; session: Allowance; week: Allowance; period: Allowance & { start: string }; sessionHours: number; extra?: { balance: number; nextExpiry: number | null } }

export interface SessionInfo {
  mode: "saas" | "byok" | "desktop" | "company";
  user: { id: string; email: string; name: string; role: "superadmin" | "admin" | "support" | "user"; plan: string; planExpires: number | null; emailVerified: number } | null;
  plan?: { id: string; name: string; monthlyCredits: number; weeklyCredits: number; sessionCredits: number; sessionHours?: number; features: string[]; vision: boolean; localAI?: boolean };
  allowedModels?: { provider: string; model: string }[];
  upgradeModels?: { provider: string; model: string; plan: string; planId: string }[];
  /** AI credits: what can be spent now, and each allowance (limit null = unlimited; resetsAt epoch ms, null = session not started) */
  usage?: UsageInfo;
  renewal?: { status: "none" | "ok" | "expiring" | "grace" | "expired"; daysLeft: number | null };
  plans?: { id: string; name: string; priceMonthly: number; currency: string; monthlyCredits: number; weeklyCredits: number; sessionCredits: number; sessionHours?: number; features: string[]; perSeat?: boolean; minSeats?: number }[];
  inTeam?: boolean;
  /** company edition: no account exists yet → offer to create the owner account */
  setupNeeded?: boolean;
  /** the signed-in user must verify their email before using the app */
  mustVerify?: boolean;
  /** company edition: licence state (message shown as a banner when set) */
  license?: { status: string; message: string | null; company: string | null; seats: number; expires: string | null; chatAllowed: boolean };
  avatar?: string;
  /** SaaS: cloud backup quota (desktop/byok reuse `cloud` for the linked account instead) */
  cloudQuota?: { limitBytes: number; usedBytes: number; maxItems: number; count: number };
  /** desktop/byok: linked hosted account */
  cloud?: { linked: boolean; backendUrl?: string; email?: string; offline?: boolean; allowedModels?: { provider: string; model: string }[]; plan?: { name: string }; usage?: UsageInfo };
}

/** Accounts, sign-in and server-held keys: the hosted service and company installs. */
export const accountsMode = (s?: SessionInfo | null) => s?.mode === "saas" || s?.mode === "company";

let cache: SessionInfo | null = null;
const listeners = new Set<() => void>();
export async function refreshSession(): Promise<SessionInfo> {
  const r = await fetch("/api/auth/me", { cache: "no-store" });
  const raw = (await r.json()) as SessionInfo & { cloud?: unknown };
  const info: SessionInfo = raw.mode === "saas" || raw.mode === "company" ? { ...raw, cloudQuota: raw.cloud as SessionInfo["cloudQuota"], cloud: undefined } : raw;
  if (info.mode !== "saas") { try { info.cloud = await (await fetch("/api/cloud/me", { cache: "no-store" })).json(); } catch { /* offline */ } }
  cache = info;
  listeners.forEach((l) => l());
  return cache;
}
export function useSession(): SessionInfo | null {
  const [s, setS] = useState<SessionInfo | null>(cache);
  useEffect(() => {
    const l = () => setS(cache);
    listeners.add(l);
    if (!cache) refreshSession().catch(() => {});
    return () => { listeners.delete(l); };
  }, []);
  return s;
}
export async function logoutClient() { await fetch("/api/auth/logout", { method: "POST" }); cache = null; window.location.assign(new URL("/login", window.location.origin).toString()); }
