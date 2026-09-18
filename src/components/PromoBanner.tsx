"use client";
import { useEffect, useState } from "react";
import { X, ExternalLink } from "lucide-react";

export interface PromoView { id: string; title: string; text: string; linkUrl: string; linkLabel: string; image: string; dismissible: boolean; sponsored: boolean }

/** Presentational banner (also used for the admin preview). */
export function PromoCard({ p, compact, onDismiss, onClick }: { p: PromoView; compact?: boolean; onDismiss?: () => void; onClick?: () => void }) {
  return (
    <div className={`relative card ${compact ? "p-2.5" : "p-3"} flex items-center gap-3 border-accent/30 bg-gradient-to-r from-accent/10 to-transparent`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {p.image && <img src={p.image} alt="" className={`${compact ? "h-10 w-10" : "h-12 w-12 md:h-14 md:w-auto md:max-w-[140px]"} rounded-lg object-contain bg-white/90 shrink-0`} />}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">{p.title && <div className={`font-medium ${compact ? "text-xs" : "text-sm"} truncate`}>{p.title}</div>}{p.sponsored && <span className="text-[10px] uppercase tracking-wide text-muted border border-border rounded px-1">Sponsored</span>}</div>
        {p.text && <div className={`${compact ? "text-[11px]" : "text-xs"} text-muted line-clamp-2`}>{p.text}</div>}
      </div>
      {p.linkUrl && (p.linkUrl.startsWith("/") ? <a href={p.linkUrl} onClick={onClick} className={`btn ${compact ? "btn-sm !px-2" : "btn-sm"} btn-primary shrink-0`}>{p.linkLabel || "Learn more"}</a> : <a href={p.linkUrl} target="_blank" rel="noopener noreferrer sponsored" onClick={onClick} className={`btn ${compact ? "btn-sm !px-2" : "btn-sm"} btn-primary shrink-0`}>{p.linkLabel || "Learn more"} <ExternalLink size={12} /></a>)}
      {p.dismissible && onDismiss && <button className="absolute top-1 right-1 text-muted hover:text-fg" onClick={onDismiss} aria-label="Hide"><X size={13} /></button>}
    </div>
  );
}

/** Fetches the active banner(s) for this placement and shows one (random), counting views once per browser session. */
export function PromoBanner({ placement, compact }: { placement: "chat" | "sidebar" | "share"; compact?: boolean }) {
  const [p, setP] = useState<PromoView | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/promo?placement=${placement}`).then((r) => r.json()).then((j: { promos: PromoView[] }) => {
      const list = (j.promos ?? []).filter((x) => { try { return localStorage.getItem(`promo-hidden:${x.id}`) !== "1"; } catch { return true; } });
      if (!alive || !list.length) return;
      const pick = list[Math.floor(Math.random() * list.length)];
      setP(pick);
      try { if (!sessionStorage.getItem(`promo-seen:${pick.id}`)) { sessionStorage.setItem(`promo-seen:${pick.id}`, "1"); fetch("/api/promo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: pick.id, event: "view" }) }).catch(() => {}); } } catch { /* ignore */ }
    }).catch(() => {});
    return () => { alive = false; };
  }, [placement]);
  if (!p) return null;
  return <PromoCard p={p} compact={compact} onDismiss={() => { try { localStorage.setItem(`promo-hidden:${p.id}`, "1"); } catch { /* ignore */ } setP(null); }} onClick={() => { fetch("/api/promo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: p.id, event: "click" }) }).catch(() => {}); }} />;
}
