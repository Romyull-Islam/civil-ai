import { logout, sessionCookie } from "@/lib/saas/service";
export const runtime = "nodejs";
export async function POST(req: Request) {
  await logout(req);
  return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json", "Set-Cookie": sessionCookie("", 0) } });
}
