"use client";
import { useEffect, useState } from "react";

/** Current time that refreshes every `ms` (for countdowns such as "resets in 2 h 14 min"). */
export function useNow(ms = 60000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}
