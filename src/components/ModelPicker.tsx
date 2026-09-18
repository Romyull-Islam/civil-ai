"use client";
import { useSettings, saveSettings } from "@/lib/client/settings";
import { PROVIDERS } from "@/lib/ai/registry";
import { useSession } from "@/lib/client/session";

/** Compact provider/model switcher shown under the chat box. Same settings as the Settings page. */
export function ModelPicker() {
  const s = useSettings();
  const session = useSession();
  if (session?.mode === "saas") {
    const allowed = session.allowedModels ?? [];
    const cur = allowed.find((m) => m.provider === s.provider && m.model === s.model) ?? allowed[0];
    return (
      <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted">
        <span>Model:</span>
        <select className="select !w-auto !py-0.5 !px-1.5 !text-[11px]" value={cur ? `${cur.provider}|${cur.model}` : ""} onChange={(e) => { const [provider, model] = e.target.value.split("|"); saveSettings({ ...s, provider, model }); }} aria-label="Model">
          {allowed.map((m) => <option key={m.provider + m.model} value={`${m.provider}|${m.model}`}>{PROVIDERS.find((p) => p.id === m.provider)?.models.find((x) => x.id === m.model)?.label ?? m.model} · {PROVIDERS.find((p) => p.id === m.provider)?.label ?? m.provider}</option>)}
        </select>
        {session.usage?.limit != null && <span>· {session.usage.remaining} of {session.usage.limit} requests left today</span>}
      </div>
    );
  }
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
        {cloud.usage?.limit != null && <span>· cloud: {cloud.usage.remaining} of {cloud.usage.limit} left today</span>}
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
