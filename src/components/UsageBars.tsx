"use client";
import type { Allowance, UsageInfo } from "@/lib/client/session";

const bd = (ms: number, opts: Intl.DateTimeFormatOptions) => new Date(ms).toLocaleString("en-GB", { timeZone: "Asia/Dhaka", ...opts });

function resetText(a: Allowance, kind: "session" | "week" | "period", hours: number): string {
  if (a.resetsAt === null) return `Starts with your next question and lasts ${hours} hours`;
  const mins = Math.max(0, Math.round((a.resetsAt - Date.now()) / 60000));
  if (kind === "session") return mins < 60 ? `Resets in ${mins} min` : `Resets in ${Math.floor(mins / 60)} h ${mins % 60} min`;
  return `Resets ${bd(a.resetsAt, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`;
}

function Bar({ label, a, kind, hours }: { label: string; a: Allowance; kind: "session" | "week" | "period"; hours: number }) {
  const pct = a.limit ? Math.min(100, (100 * a.used) / a.limit) : 0;
  const tone = pct >= 100 ? "bg-err" : pct >= 80 ? "bg-accent" : "bg-accent2";
  return (
    <div className="grid gap-1">
      <div className="flex items-baseline justify-between gap-2 text-sm"><span className="font-medium">{label}</span><span className="text-xs text-muted">{a.limit === null ? `${a.used} used (unlimited)` : `${a.used} of ${a.limit} credits`}</span></div>
      <div className="h-2 rounded bg-elev2 overflow-hidden"><div className={`h-full ${tone}`} style={{ width: `${pct}%` }} /></div>
      <div className="text-xs text-muted">{resetText(a, kind, hours)}</div>
    </div>
  );
}

/** Session / week / billing-period credit bars, like the usage page of Claude plans. */
export function UsageBars({ usage, compact = false }: { usage: UsageInfo; compact?: boolean }) {
  return (
    <div className={`grid ${compact ? "gap-2" : "gap-4"}`}>
      <Bar label="Current session" a={usage.session} kind="session" hours={usage.sessionHours} />
      <Bar label="This week" a={usage.week} kind="week" hours={usage.sessionHours} />
      <Bar label="This month" a={usage.period} kind="period" hours={usage.sessionHours} />
      {!compact && <p className="text-xs text-muted">Each answer uses credits by the model you pick and the length of the conversation. Spend your monthly credits whenever you need them; the weekly and session limits only stop a single day from using everything. Calculators, drawings, the code library and the offline desktop model never use credits.</p>}
    </div>
  );
}
