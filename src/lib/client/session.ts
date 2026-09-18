"use client";
import { useEffect, useState } from "react";

export interface SessionInfo {
  mode: "saas" | "byok" | "desktop";
  user: { id: string; email: string; name: string; role: "superadmin" | "admin" | "support" | "user"; plan: string; planExpires: number | null; emailVerified: number } | null;
  plan?: { id: string; name: string; dailyRequests: number; features: string[]; vision: boolean; localAI?: boolean };
  allowedModels?: { provider: string; model: string }[];
  usage?: { used: number; limit: number | null; remaining: number | null };
  renewal?: { status: "none" | "ok" | "expiring" | "grace" | "expired"; daysLeft: number | null };
  plans?: { id: string; name: string; priceMonthly: number; currency: string; dailyRequests: number; features: string[]; perSeat?: boolean; minSeats?: number }[];
  inTeam?: boolean;
  /** desktop/byok: linked hosted account */
  cloud?: { linked: boolean; backendUrl?: string; email?: string; offline?: boolean; allowedModels?: { provider: string; model: string }[]; plan?: { name: string }; usage?: { used: number; limit: number | null; remaining: number | null } };
}

let cache: SessionInfo | null = null;
const listeners = new Set<() => void>();
export async function refreshSession(): Promise<SessionInfo> {
  const r = await fetch("/api/auth/me", { cache: "no-store" });
  const info = (await r.json()) as SessionInfo;
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
