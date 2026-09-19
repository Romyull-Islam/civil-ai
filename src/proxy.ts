import { NextResponse, type NextRequest } from "next/server";

/** SaaS mode: send signed-out visitors to /login (pages) or 401 (APIs). Session validity is checked in the route handlers. */
export function proxy(req: NextRequest) {
  const mode = process.env.CIVIL_AI_MODE ?? (process.env.CIVIL_AI_DESKTOP ? "desktop" : "saas");
  if (mode !== "saas" && mode !== "company") return NextResponse.next();
  const { pathname } = req.nextUrl;
  const under = (list: string[]) => list.some((p) => pathname === p || pathname.startsWith(p + "/"));
  // Company installs: no payments, plans, promotions or link to CivilMate's cloud; everything else needs a signed-in user.
  if (mode === "company" && under(["/pricing", "/subscribe", "/billing", "/team", "/refund-policy", "/api/checkout", "/api/payments", "/api/billing", "/api/team", "/api/webhooks", "/api/promo", "/api/cloud", "/api/cron", "/api/admin/payments", "/api/admin/gateways", "/api/admin/plans", "/api/admin/packs", "/api/admin/credits", "/api/admin/teams", "/api/admin/promo-stats"])) {
    return pathname.startsWith("/api/") ? NextResponse.json({ error: "Not available in the company edition" }, { status: 404 }) : NextResponse.redirect(new URL("/", req.url));
  }
  const open = mode === "company" ? ["/login", "/signup", "/verify", "/forgot", "/reset", "/help", "/terms", "/privacy", "/api/auth", "/api/health", "/api/site", "/favicon.ico"] : ["/login", "/signup", "/verify", "/forgot", "/reset", "/pricing", "/help", "/terms", "/privacy", "/refund-policy", "/share", "/api/share", "/api/promo", "/api/auth", "/api/health", "/api/tools", "/api/site", "/api/tickets", "/api/checkout/return", "/api/checkout/ipn", "/api/webhooks", "/api/cron", "/favicon.ico"];
  if (under(open)) return NextResponse.next();
  // CSRF: cookie-authenticated state-changing API calls must come from this site (gateway returns/IPNs/webhooks are in `open`).
  if (pathname.startsWith("/api/") && req.method !== "GET" && req.cookies.get("civil_session")?.value) {
    const origin = req.headers.get("origin") ?? (req.headers.get("referer") ? new URL(req.headers.get("referer")!).origin : null);
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
    const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
    const allowed = new Set([`${proto}://${host}`, req.nextUrl.origin, process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? ""]);
    if (origin && !allowed.has(origin)) return NextResponse.json({ error: "Cross-site request blocked" }, { status: 403 });
  }
  if (req.cookies.get("civil_session")?.value || req.headers.get("authorization")?.startsWith("Bearer ")) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const url = req.nextUrl.clone(); url.pathname = "/login"; url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/((?!_next/static|_next/image|.*\\.(?:png|svg|ico|jpg|jpeg|webp|woff2?)$).*)"] };
