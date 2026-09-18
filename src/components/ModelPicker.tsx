"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Sparkles, ChevronDown, Check, Eye, Lock } from "lucide-react";
import { useSettings, saveSettings } from "@/lib/client/settings";
import { friendlyModel, TIER_LABEL, type Tier } from "@/lib/ai/friendly";
import { PROVIDERS } from "@/lib/ai/registry";
import { useSession } from "@/lib/client/session";
import { estimateCredits } from "@/lib/saas/credits";

/** Compact provider/model switcher shown under the chat box. Same settings as the Settings page. */
export function ModelPicker() {
  const s = useSettings();
  const session = useSession();
  if (session?.mode === "saas") return <PlanModelChooser />;
  const cloud = session?.cloud;
  if (cloud?.linked && cloud.allowedModels?.length) {
    const cur = s.provider === "local" || s.provider === "local-first" || s.provider === "ollama" ? "local" : `${s.provider}|${s.model ?? cloud.allowedModels.find((m) => m.provider === s.provider)?.model ?? ""}`;
    return (
      <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted">
        <span>Model:</span>
        <select className="select !w-auto !py-0.5 !px-1.5 !text-[11px]" value={cur} onChange={(e) => { if (e.target.value === "local") saveSettings({ ...s, provider: "local-first", model: undefined }); else { const [provider, model] = e.target.value.split("|"); saveSettings({ ...s, provider, model }); } }} aria-label="Model">
          <option value="local">Local model (offline, unlimited)</option>
          {cloud.allowedModels.map((m) => <option key={m.provider + m.model} value={`${m.provider}|${m.model}`}>☁ {PROVIDERS.find((p) => p.id === m.provider)?.models.find((x) => x.id === m.model)?.label ?? m.model} · {cloud.plan?.name ?? "cloud"}</option>)}
        </select>
        {cloud.usage?.remaining != null && <span>· cloud: {cloud.usage.remaining} credits left</span>}
      </div>
    );
  }
  const prov = PROVIDERS.find((p) => p.id === s.provider);
  const models = prov ? [...prov.models.map((m) => m.id), ...(s.keys[prov.id]?.model && !prov.models.some((m) => m.id === s.keys[prov.id]?.model) ? [s.keys[prov.id]!.model!] : [])] : [];
  return (
    <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted">
      <span>Model:</span>
      <select className="select !w-auto !py-0.5 !px-1.5 !text-[11px]" value={s.provider} onChange={(e) => saveSettings({ ...s, provider: e.target.value, model: undefined })} aria-label="Provider">
        <option value="auto">Auto (free cloud → local)</option>
        <option value="local-first">Local first (offline)</option>
        {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>
      {prov && (
        <select className="select !w-auto !py-0.5 !px-1.5 !text-[11px]" value={s.model ?? ""} onChange={(e) => saveSettings({ ...s, model: e.target.value || undefined })} aria-label="Model">
          <option value="">{prov.models[0]?.label ?? "default"} (default)</option>
          {models.map((id) => <option key={id} value={id}>{prov.models.find((m) => m.id === id)?.label ?? id}</option>)}
        </select>
      )}
    </div>
  );
}

/** "2 credits" per typical engineering question, from the model's price (see lib/saas/credits.ts). */
function creditLabel(provider: string, model: string): string {
  const c = estimateCredits(provider, model);
  return c < 1.5 ? "1 credit" : `${Math.round(c)} credits`;
}

const TIER_STYLE: Record<Tier, string> = { fast: "text-ok border-ok/40", smart: "text-accent2 border-accent2/40", best: "text-accent border-accent/50" };

/** SaaS users: "Auto" or one of the plan's models, in plain language; higher-plan models shown locked with an upgrade link. */
function PlanModelChooser() {
  const s = useSettings();
  const session = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  const allowed = session?.allowedModels ?? [];
  const locked = session?.upgradeModels ?? [];
  const label = (p: string, m: string) => PROVIDERS.find((x) => x.id === p)?.models.find((x) => x.id === m)?.label;
  const cur = allowed.find((m) => m.provider === s.provider && m.model === s.model);
  const curName = cur ? friendlyModel(cur.provider, cur.model, label(cur.provider, cur.model)).name : "Auto";
  const pick = (provider: string, model?: string) => { saveSettings({ ...s, provider, model }); setOpen(false); };
  return (
    <div className="relative flex items-center gap-2 text-[12px] text-muted" ref={ref}>
      <button className="flex items-center gap-1.5 rounded-lg px-2 py-1 hover:bg-elev2 text-fg" onClick={() => setOpen((v) => !v)} title="Choose model">
        <Sparkles size={13} className="text-accent" /> {curName} <ChevronDown size={13} className={`transition ${open ? "rotate-180" : ""}`} />
      </button>
      {session?.usage?.remaining != null && <span className="hidden sm:inline" title={`Today ${session.usage.used} of ${session.usage.limit} credits · this period ${session.usage.periodUsed} of ${session.usage.periodLimit}`}>{session.usage.remaining} credits left</span>}
      {open && (
        <div className="absolute bottom-full left-0 mb-2 w-80 max-h-[60vh] overflow-y-auto card p-1 shadow-xl z-50 text-sm">
          <button className="w-full text-left rounded-lg px-3 py-2 hover:bg-elev2 flex gap-2" onClick={() => pick("auto")}>
            <Sparkles size={16} className="text-accent mt-0.5 shrink-0" />
            <div className="flex-1"><div className="font-medium flex items-center gap-2">Auto <span className="badge">recommended</span></div><div className="text-xs text-muted">Uses your plan&apos;s default model and switches automatically if one is busy. Credits are charged by the model that answers.</div></div>
            {!cur && <Check size={16} className="text-ok shrink-0" />}
          </button>
          <div className="label px-3 pt-2 pb-1">Your plan{session?.plan?.name ? ` (${session.plan.name})` : ""}</div>
          {allowed.map((m) => { const f = friendlyModel(m.provider, m.model, label(m.provider, m.model)); const active = cur?.provider === m.provider && cur?.model === m.model; return (
            <button key={m.provider + m.model} className="w-full text-left rounded-lg px-3 py-2 hover:bg-elev2 flex gap-2" onClick={() => pick(m.provider, m.model)}>
              <div className="flex-1 min-w-0"><div className="font-medium flex items-center gap-2">{f.name}<span className={`badge ${TIER_STYLE[f.tier]}`}>{TIER_LABEL[f.tier]}</span>{f.vision && <Eye size={13} className="text-muted" aria-label="reads images" />}<span className="ml-auto text-[11px] text-muted font-normal">≈{creditLabel(m.provider, m.model)}</span></div>{f.blurb && <div className="text-xs text-muted">{f.blurb}</div>}</div>
              {active && <Check size={16} className="text-ok shrink-0" />}
            </button>); })}
          {locked.length > 0 && (
            <>
              <div className="label px-3 pt-2 pb-1">More with an upgrade</div>
              {locked.slice(0, 6).map((m) => { const f = friendlyModel(m.provider, m.model, label(m.provider, m.model)); return (
                <Link key={m.provider + m.model} href={`/subscribe?plan=${m.planId}`} className="flex gap-2 rounded-lg px-3 py-2 hover:bg-elev2 opacity-70" onClick={() => setOpen(false)}>
                  <Lock size={14} className="mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0"><div className="font-medium flex items-center gap-2">{f.name}<span className={`badge ${TIER_STYLE[f.tier]}`}>{TIER_LABEL[f.tier]}</span></div><div className="text-xs text-muted">{f.blurb ? `${f.blurb} · ` : ""}{m.plan} plan</div></div>
                </Link>); })}
            </>
          )}
        </div>
      )}
    </div>
  );
}
