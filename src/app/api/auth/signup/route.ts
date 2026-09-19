import { hasAccounts, isCompany } from "@/lib/saas/mode";
import { getDB } from "@/lib/saas/db";
import { signup, sessionCookie, publicUser } from "@/lib/saas/service";
import { rateLimit, clientIp } from "@/lib/saas/security";
export const runtime = "nodejs";
export async function POST(req: Request) {
  if (!hasAccounts()) return Response.json({ error: "Accounts are only used in SaaS mode" }, { status: 400 });
  // Company edition: only the first (owner) account signs up; the administrator creates everyone else.
  if (isCompany() && (await (await getDB()).countUsers()) > 0) return Response.json({ error: "Accounts are created by your administrator. Ask them to add you." }, { status: 403 });
  if (!rateLimit(`signup:${clientIp(req)}`, 10, 3600000)) return Response.json({ error: "Too many sign-ups from this network, try later" }, { status: 429 });
  try {
    const { email, password, name } = (await req.json()) as { email: string; password: string; name?: string };
    const { user, token } = await signup(email, password, name);
    // Verification required: no session yet; the visitor enters the emailed code on /verify.
    if (!token) return Response.json({ needsVerification: true, email: user.email }, { status: 201 });
    return new Response(JSON.stringify({ user: publicUser(user), token }), { status: 201, headers: { "Content-Type": "application/json", "Set-Cookie": sessionCookie(token) } });
  } catch (e) { return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 }); }
}
