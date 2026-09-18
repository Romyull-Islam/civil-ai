import { getSessionUser, openTicket } from "@/lib/saas/service";
import { getDB } from "@/lib/saas/db";
export const runtime = "nodejs";
const recent = new Map<string, number[]>();
export async function GET(req: Request) {
  const user = await getSessionUser(req);
  if (!user) return Response.json({ tickets: [] });
  return Response.json({ tickets: await (await getDB()).listTickets({ userId: user.id, limit: 50 }) });
}
export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const times = (recent.get(ip) ?? []).filter((t) => Date.now() - t < 3600000);
  if (times.length >= 5) return Response.json({ error: "Too many tickets, try later" }, { status: 429 });
  const user = await getSessionUser(req);
  try {
    const body = (await req.json()) as { email?: string; subject: string; message: string };
    const t = await openTicket({ userId: user?.id ?? null, email: user?.email ?? body.email ?? "", subject: body.subject, message: body.message });
    recent.set(ip, [...times, Date.now()]);
    return Response.json({ ticket: t }, { status: 201 });
  } catch (e) { return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 }); }
}
