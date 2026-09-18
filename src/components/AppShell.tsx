"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { MessageSquare, Calculator, PencilRuler, BookOpen, Settings, HardHat, Menu, X, Shield, User, CreditCard, LifeBuoy } from "lucide-react";
import { useSession } from "@/lib/client/session";
import { useSettings } from "@/lib/client/settings";

const NAV = [
  { href: "/", label: "Assistant", icon: MessageSquare },
  { href: "/calculators", label: "Calculators", icon: Calculator },
  { href: "/drawings", label: "Drawings", icon: PencilRuler },
  { href: "/codes", label: "Code library", icon: BookOpen },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const settings = useSettings();
  const session = useSession();
  const saas = session?.mode === "saas";
  const nav = [...NAV, ...(saas ? [{ href: "/pricing", label: "Plans", icon: CreditCard }, { href: "/account", label: "Account", icon: User }, { href: "/help", label: "Help", icon: LifeBuoy }] : []), ...(saas && session?.user && session.user.role !== "user" ? [{ href: "/admin", label: session.user.role === "support" ? "Helpdesk" : "Admin", icon: Shield }] : [])];
  const authPage = ["/login", "/signup", "/verify", "/forgot", "/reset"].includes(path);
  useEffect(() => {
    const dark = settings.theme === "dark" || (settings.theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [settings.theme]);
  if (authPage) return <div className="h-full">{children}</div>;
  return (
    <div className="flex h-full">
      <aside className={`${open ? "flex" : "hidden"} md:flex w-60 shrink-0 flex-col border-r border-border bg-elev fixed md:static inset-y-0 left-0 z-40`}>
        <div className="flex items-center gap-2 px-4 py-4 border-b border-border">
          <HardHat className="text-accent" size={22} />
          <div>
            <div className="font-semibold leading-tight">Civil AI</div>
            <div className="text-xs text-muted">Engineering assistant</div>
          </div>
          <button className="ml-auto md:hidden" onClick={() => setOpen(false)} aria-label="Close menu"><X size={18} /></button>
        </div>
        <nav className="flex flex-col gap-1 p-2">
          {nav.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? path === "/" : path.startsWith(href);
            return (
              <Link key={href} href={href} onClick={() => setOpen(false)} className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${active ? "bg-elev2 text-fg font-medium" : "text-muted hover:bg-elev2 hover:text-fg"}`}>
                <Icon size={17} /> {label}
              </Link>
            );
          })}
        </nav>
        {saas && session?.user && <div className="px-3 py-2 text-xs text-muted border-t border-border truncate">{session.user.email} · <span className="text-fg">{session.plan?.name}</span>{session.usage?.limit != null ? ` · ${session.usage.remaining} left today` : ""}</div>}
        <div className="mt-auto p-3 text-[11px] text-muted leading-snug border-t border-border">
          Preliminary calculations only. Final designs must be verified by a licensed engineer.
        </div>
      </aside>
      {open && <div className="fixed inset-0 bg-black/50 z-30 md:hidden" onClick={() => setOpen(false)} />}
      <main className="flex-1 min-w-0 flex flex-col h-full">
        <div className="md:hidden flex items-center gap-2 px-3 py-2 border-b border-border bg-elev">
          <button onClick={() => setOpen(true)} aria-label="Open menu"><Menu size={20} /></button>
          <HardHat className="text-accent" size={18} /> <span className="font-semibold">Civil AI</span>
        </div>
        {saas && session?.renewal && (session.renewal.status === "expiring" || session.renewal.status === "grace") && <div className={`${session.renewal.status === "grace" ? "bg-err/15 border-err/40" : "bg-accent/15 border-accent/40"} border-b text-sm px-4 py-2`}>{session.renewal.status === "grace" ? `Your ${session.plan?.name} plan has expired; it keeps working for a few more days.` : `Your ${session.plan?.name} plan expires in ${session.renewal.daysLeft} day${session.renewal.daysLeft === 1 ? "" : "s"}.`} <Link href={`/subscribe?plan=${session.user?.plan}`} className="text-accent2 underline">Renew now</Link></div>}
        {saas && session?.user && !session.user.emailVerified && <div className="bg-accent/15 border-b border-accent/40 text-sm px-4 py-2">Please verify your email to use the AI assistant. <Link href="/verify" className="text-accent2 underline">Enter code</Link></div>}
        {children}
      </main>
    </div>
  );
}
