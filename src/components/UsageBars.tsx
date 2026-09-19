"use client";
import Link from "next/link";
import type { Allowance, UsageInfo } from "@/lib/client/session";

const bd = (ms: number, opts: Intl.DateTimeFormatOptions) => new Date(ms).toLocaleString("en-GB", { timeZone: "Asia/Dhaka", ...opts });

function resetText(a: Allowance, kind: "session" | "week" | "period", hours: number, now: number): string {
  if (a.resetsAt === null) return `Starts with your next question and lasts ${hours} hours`;
  const mins = Math.max(0, Math.round((a.resetsAt - now) / 60000));
  if (kind === "session") return mins < 60 ? `Resets in ${mins} min` : `Resets in ${Math.floor(mins / 60)} h ${mins % 60} min`;
  return `Resets ${bd(a.resetsAt, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`;
}

function Bar({ label, a, kind, hours, now, compact }: { label: string; a: Allowance; kind: "session" | "week" | "period"; hours: number; now: number; compact: boolean }) {
  const pct = a.limit ? Math.min(100, (100 * a.used) / a.limit) : 0;
  const tone = pct >= 100 ? "bg-err" : pct >= 80 ? "bg-accent" : "bg-accent2";
  return (
    <div className="grid gap-1">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-xs text-muted">{a.limit === null ? `${a.used} credits used (unlimited)` : <><b className="text-fg">{Math.round(pct)}% used</b>{compact ? "" : ` · ${a.used} of ${a.limit} credits`}</>}</span>
      </div>
      <div className="h-2 rounded bg-elev2 overflow-hidden"><div className={`h-full ${tone}`} style={{ width: `${pct}%` }} /></div>
      <div className="text-xs text-muted">{resetText(a, kind, hours, now)}</div>
    </div>
  );
}

/** Session / week / month usage like Claude plans' usage page, plus purchased extra credits. */
export function UsageBars({ usage, compact = false, now }: { usage: UsageInfo; compact?: boolean; now: number }) {
  const extra = usage.extra?.balance ?? 0;
  const usingExtra = usage.allowanceRemaining === 0 && extra > 0;
  return (
    <div className={`grid ${compact ? "gap-2" : "gap-4"}`}>
      <Bar label="Current session" a={usage.session} kind="session" hours={usage.sessionHours} now={now} compact={compact} />
      <Bar label="This week" a={usage.week} kind="week" hours={usage.sessionHours} now={now} compact={compact} />
      <Bar label="This month" a={usage.period} kind="period" hours={usage.sessionHours} now={now} compact={compact} />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">Extra credits</span>
        <span className="text-xs text-muted">{extra > 0 ? `${extra} left${usage.extra?.nextExpiry ? `, first ones expire ${bd(usage.extra.nextExpiry, { day: "numeric", month: "short", year: "numeric" })}` : ""}${usingExtra ? " (in use now)" : ""}` : "none"}</span>
        <Link href="/billing#credits" className="btn btn-sm ml-auto">Buy more credits</Link>
      </div>
      {!compact && <p className="text-xs text-muted">Unused credits do not carry over: each session and each week starts again from zero. Your monthly credits can be spent in any week, within the weekly and 5-hour session limits. Extra credits are used only when a limit is reached, so you can keep working. Calculators, drawings, the code library and the offline desktop model never use credits.</p>}
    </div>
  );
}
