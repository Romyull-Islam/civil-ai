import { NextResponse, type NextRequest } from "next/server";

/** SaaS mode: send signed-out visitors to /login (pages) or 401 (APIs). Session validity is checked in the route handlers. */
export function proxy(req: NextRequest) {
  const mode = process.env.CIVIL_AI_MODE ?? (process.env.CIVIL_AI_DESKTOP ? "desktop" : "saas");
  if (mode !== "saas") return NextResponse.next();
  const { pathname } = req.nextUrl;
  const open = ["/login", "/signup", "/verify", "/forgot", "/reset", "/pricing", "/help", "/terms", "/privacy", "/refund-policy", "/api/auth", "/api/health", "/api/tools", "/api/site", "/api/tickets", "/api/checkout/return", "/api/checkout/ipn", "/api/webhooks", "/api/cron", "/favicon.ico"];
  if (open.some((p) => pathname === p || pathname.startsWith(p + "/"))) return NextResponse.next();
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
