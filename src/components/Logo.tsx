import { APP_NAME } from "@/lib/brand";

/** The CivilMate mark (amber tile, white C, truss) as inline SVG — same geometry as public/brand/civilmate-mark.svg. */
export function LogoMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={`shrink-0 ${className}`} aria-hidden="true">
      <defs><linearGradient id="cmTileInline" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#F7B53A" /><stop offset="1" stopColor="#E5850B" /></linearGradient></defs>
      <rect x="2" y="2" width="60" height="60" rx="14" fill="url(#cmTileInline)" />
      <path d="M43.13 20.62 A17 17 0 1 0 43.13 43.38" fill="none" stroke="#fff" strokeWidth={size < 24 ? 8.6 : 7.6} strokeLinecap="round" />
      <path d="M25.2 37.4 L36.8 37.4 L31 27.4 Z" fill="none" stroke="#fff" strokeWidth={size < 24 ? 3.2 : 2.1} strokeLinejoin="round" />
      {[[25.2, 37.4], [36.8, 37.4], [31, 27.4]].map(([cx, cy]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={size < 24 ? 3.9 : 2.9} fill="#fff" />)}
    </svg>
  );
}

/** Mark + wordmark ("Civil" neutral, "Mate" amber). */
export function Logo({ size = 26, showText = true, className = "" }: { size?: number; showText?: boolean; className?: string }) {
  const split = APP_NAME === "CivilMate";
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <LogoMark size={size} />
      {showText && <span className="font-bold tracking-tight leading-none" style={{ fontSize: size * 0.68 }}>{split ? <>Civil<span className="text-accent">Mate</span></> : APP_NAME}</span>}
    </span>
  );
}
