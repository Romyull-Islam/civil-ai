"use client";
import { useSyncExternalStore, useCallback } from "react";

/** A boolean UI preference persisted in localStorage, hydration-safe (server renders the default). */
export function usePersistedFlag(key: string, defaultValue: boolean): [boolean, () => void] {
  const subscribe = useCallback((cb: () => void) => { window.addEventListener("civil-ai:flag:" + key, cb); return () => window.removeEventListener("civil-ai:flag:" + key, cb); }, [key]);
  const get = useCallback(() => { try { const v = localStorage.getItem(key); return v === null ? defaultValue : v === "1"; } catch { return defaultValue; } }, [key, defaultValue]);
  const value = useSyncExternalStore(subscribe, get, () => defaultValue);
  const toggle = useCallback(() => { try { localStorage.setItem(key, value ? "0" : "1"); } catch { /* ignore */ } window.dispatchEvent(new Event("civil-ai:flag:" + key)); }, [key, value]);
  return [value, toggle];
}
