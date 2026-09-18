"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { MessageSquare, Calculator, PencilRuler, BookOpen, Settings, HardHat, Menu, X, Shield, User, CreditCard, LifeBuoy, Users, Cloud, ChevronsLeft, ChevronsRight, Plus, LogOut, BarChart3, ChevronUp, Sparkles } from "lucide-react";
import { useSettings } from "@/lib/client/settings";
import { useSession, logoutClient } from "@/lib/client/session";
import { usePersistedFlag } from "@/lib/client/persist";
import { db } from "@/lib/db";

const MAIN = [
  { href: "/", label: "Assistant", icon: MessageSquare },
  { href: "/calculators", label: "Calculators", icon: Calculator },
  { href: "/drawings", label: "Drawings", icon: PencilRuler },
  { href: "/codes", label: "Code library", icon: BookOpen },
];

// eslint-disable-next-line @next/next/no-img-element
const Avatar = ({ src, size = 28 }: { src?: string; size?: number }) => src ? <img src={src} alt="" style={{ width: size, height: size }} className="rounded-full shrink-0" /> : <div style={{ width: size, height: size }} className="rounded-full bg-elev2 flex items-center justify-center shrink-0"><User size={size * 0.55} /></div>;

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [collapsed, toggleCollapsed] = usePersistedFlag("civil-ai.nav.collapsed", false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const settings = useSettings();
  const session = useSession();
  const saas = session?.mode === "saas";
  const [recents, setRecents] = useState<{ id: string; title: string }[]>([]);
  useEffect(() => {
    const dark = settings.theme === "dark" || (settings.theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [settings.theme]);
  useEffect(() => {
    const load = () => db.conversations.orderBy("updatedAt").reverse().limit(6).toArray().then((rows) => setRecents(rows.map((r) => ({ id: r.id, title: r.title })))).catch(() => {});
    load();
    window.addEventListener("civil-ai:conversations", load);
    return () => window.removeEventListener("civil-ai:conversations", load);
  }, []);
  useEffect(() => {
    if (!menu) return;
    const onDoc = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menu]);
  const authPage = ["/login", "/signup", "/verify", "/forgot", "/reset"].includes(path);
  if (authPage) return <div className="h-full">{children}</div>;

  const user = session?.user;
  const planName = session?.plan?.name ?? (session?.mode === "desktop" ? "Desktop" : session?.mode === "byok" ? "Local" : "");
  const staff = saas && user && user.role !== "user";
  const menuItems: { href: string; label: string; icon: typeof Settings; show: boolean }[] = [
    { href: "/settings", label: "Settings", icon: Settings, show: true },
    { href: "/pricing", label: "Plans & billing", icon: CreditCard, show: saas },
    { href: "/subscribe", label: session?.plan?.id === "free" ? "Upgrade plan" : "Renew / change plan", icon: Sparkles, show: saas && !!user },
    { href: "/account", label: "Usage & account", icon: BarChart3, show: saas && !!user },
    { href: "/saves", label: "Cloud backups", icon: Cloud, show: saas && !!user },
    { href: "/team", label: "Team", icon: Users, show: saas && !!session?.inTeam },
    { href: "/admin", label: user?.role === "support" ? "Helpdesk" : "Admin", icon: Shield, show: !!staff },
    { href: "/help", label: "Help & support", icon: LifeBuoy, show: true },
  ];
  const navLink = (href: string, label: string, Icon: typeof Settings, active: boolean) => (
    <Link key={href} href={href} onClick={() => setOpen(false)} title={collapsed ? label : undefined} className={`flex items-center gap-3 rounded-lg ${collapsed ? "justify-center px-0" : "px-3"} py-2 text-sm ${active ? "bg-elev2 text-fg font-medium" : "text-muted hover:bg-elev2 hover:text-fg"}`}>
      <Icon size={17} className="shrink-0" /> {!collapsed && label}
    </Link>
  );

  return (
    <div className="flex h-full">
      <aside className={`${open ? "flex" : "hidden"} md:flex ${collapsed ? "md:w-14" : "w-64"} shrink-0 flex-col border-r border-border bg-elev fixed md:static inset-y-0 left-0 z-40 transition-[width]`}>
        <div className={`flex items-center gap-2 ${collapsed ? "px-2 justify-center" : "px-3"} py-3`}>
          <HardHat className="text-accent shrink-0" size={22} />
          {!collapsed && <div className="font-semibold leading-tight">Civil AI</div>}
          {!collapsed && <button className="ml-auto hidden md:inline-flex text-muted hover:text-fg" onClick={toggleCollapsed} title="Collapse menu"><ChevronsLeft size={16} /></button>}
          <button className="ml-auto md:hidden" onClick={() => setOpen(false)} aria-label="Close menu"><X size={18} /></button>
        </div>
        <div className={`px-2 ${collapsed ? "" : "pb-1"}`}>
          <Link href="/?new=1" onClick={() => setOpen(false)} title="New chat" className={`btn btn-primary w-full ${collapsed ? "justify-center px-0" : "justify-start"}`}><Plus size={16} /> {!collapsed && "New chat"}</Link>
        </div>
        <nav className="flex flex-col gap-0.5 p-2">
          {MAIN.map(({ href, label, icon }) => navLink(href, label, icon, href === "/" ? path === "/" : path.startsWith(href)))}
        </nav>
        {!collapsed && recents.length > 0 && (
          <div className="px-2 mt-2 min-h-0 overflow-y-auto">
            <div className="label px-3 mb-1">Recents</div>
            {recents.map((r) => <Link key={r.id} href={`/?c=${r.id}`} onClick={() => setOpen(false)} className="block truncate rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-elev2 hover:text-fg" title={r.title}>{r.title}</Link>)}
          </div>
        )}
        <div className="mt-auto p-2 relative" ref={menuRef}>
          {collapsed && <button className="w-full flex justify-center py-2 text-muted hover:text-fg" onClick={toggleCollapsed} title="Expand menu"><ChevronsRight size={16} /></button>}
          {menu && (
            <div className="absolute bottom-full left-2 right-2 mb-1 card p-1 shadow-xl z-50 min-w-56">
              {user && <div className="px-3 py-2 text-xs text-muted border-b border-border mb-1 truncate">{user.email}{planName ? ` · ${planName} plan` : ""}{session?.usage?.limit != null ? ` · ${session.usage.remaining} requests left today` : ""}</div>}
              {menuItems.filter((m) => m.show).map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={() => { setMenu(false); setOpen(false); }} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-fg hover:bg-elev2"><Icon size={16} className="text-muted" /> {label}</Link>)}
              {saas && user && <button className="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-err hover:bg-elev2" onClick={logoutClient}><LogOut size={16} /> Sign out</button>}
              {saas && !user && <Link href="/login" onClick={() => setMenu(false)} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-fg hover:bg-elev2"><User size={16} className="text-muted" /> Sign in</Link>}
            </div>
          )}
          <button className={`w-full flex items-center gap-3 rounded-lg ${collapsed ? "justify-center px-0" : "px-2"} py-2 hover:bg-elev2 text-left`} onClick={() => setMenu((v) => !v)} title="Account menu">
            <Avatar src={session?.avatar} />
            {!collapsed && <div className="min-w-0 flex-1"><div className="text-sm font-medium truncate">{user ? (user.name || user.email.split("@")[0]) : saas ? "Sign in" : "You"}</div><div className="text-[11px] text-muted truncate">{user ? `${planName} plan` : saas ? "Free to start" : planName}</div></div>}
            {!collapsed && <ChevronUp size={14} className={`text-muted transition ${menu ? "rotate-180" : ""}`} />}
          </button>
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
