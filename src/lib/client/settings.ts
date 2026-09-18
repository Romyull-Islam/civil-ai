"use client";
import { useSyncExternalStore } from "react";
import type { KeyBag } from "@/lib/ai/registry";

export interface AppSettings {
  provider: string; // "auto" or provider id
  model?: string;
  keys: KeyBag;
  preferences: { designCode?: string; units?: "SI" | "imperial"; region?: string; name?: string };
  theme: "dark" | "light" | "system";
  /** delete conversations not opened for this many days (0 = keep forever) */
  autoDeleteDays: number;
}

const KEY = "civil-ai.settings.v1";
export const DEFAULT_SETTINGS: AppSettings = { provider: typeof window !== "undefined" && (window as unknown as { civilAI?: { desktop?: boolean } }).civilAI?.desktop ? "local-first" : "auto", keys: {}, preferences: { designCode: "BNBC 2020 (Bangladesh)", units: "SI", region: "Bangladesh" }, theme: "dark", autoDeleteDays: 30 };

let cache: AppSettings | null = null;

export function loadSettings(): AppSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<AppSettings>) } : DEFAULT_SETTINGS;
  } catch { cache = DEFAULT_SETTINGS; }
  return cache;
}

export function saveSettings(s: AppSettings) {
  cache = s;
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore (private mode) */ }
  window.dispatchEvent(new Event("civil-ai:settings"));
}

function subscribe(cb: () => void) {
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) { cache = null; cb(); } };
  window.addEventListener("civil-ai:settings", cb);
  window.addEventListener("storage", onStorage);
  return () => { window.removeEventListener("civil-ai:settings", cb); window.removeEventListener("storage", onStorage); };
}

/** React hook: current settings, re-renders on change, hydration-safe (server snapshot = defaults). */
export function useSettings(): AppSettings {
  return useSyncExternalStore(subscribe, loadSettings, () => DEFAULT_SETTINGS);
}
