"use client";
import { useEffect, useState } from "react";

export interface SessionInfo {
  mode: "saas" | "byok" | "desktop";
  user: { id: string; email: string; name: string; role: "superadmin" | "admin" | "support" | "user"; plan: string; planExpires: number | null; emailVerified: number } | null;
  plan?: { id: string; name: string; monthlyCredits: number; dailyCredits: number; features: string[]; vision: boolean; localAI?: boolean };
  allowedModels?: { provider: string; model: string }[];
  upgradeModels?: { provider: string; model: string; plan: string; planId: string }[];
  /** AI credits: used/limit are today's, periodUsed/periodLimit the billing period's; remaining is what can be spent now */
  usage?: { used: number; limit: number | null; remaining: number | null; periodUsed?: number; periodLimit?: number | null; periodStart?: string };
  renewal?: { status: "none" | "ok" | "expiring" | "grace" | "expired"; daysLeft: number | null };
  plans?: { id: string; name: string; priceMonthly: number; currency: string; monthlyCredits: number; dailyCredits: number; features: string[]; perSeat?: boolean; minSeats?: number }[];
  inTeam?: boolean;
  avatar?: string;
  /** SaaS: cloud backup quota (desktop/byok reuse `cloud` for the linked account instead) */
  cloudQuota?: { limitBytes: number; usedBytes: number; maxItems: number; count: number };
  /** desktop/byok: linked hosted account */
  cloud?: { linked: boolean; backendUrl?: string; email?: string; offline?: boolean; allowedModels?: { provider: string; model: string }[]; plan?: { name: string }; usage?: { used: number; limit: number | null; remaining: number | null } };
}

let cache: SessionInfo | null = null;
const listeners = new Set<() => void>();
export async function refreshSession(): Promise<SessionInfo> {
  const r = await fetch("/api/auth/me", { cache: "no-store" });
  const raw = (await r.json()) as SessionInfo & { cloud?: unknown };
  const info: SessionInfo = raw.mode === "saas" ? { ...raw, cloudQuota: raw.cloud as SessionInfo["cloudQuota"], cloud: undefined } : raw;
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
