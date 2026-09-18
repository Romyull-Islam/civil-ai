import { guardArea } from "@/lib/saas/admin";
import { getDB } from "@/lib/saas/db";
import { answerTicket } from "@/lib/saas/service";
export const runtime = "nodejs";
export const GET = guardArea("tickets", async (req) => { const status = new URL(req.url).searchParams.get("status") ?? undefined; return Response.json({ tickets: await (await getDB()).listTickets({ status, limit: 500 }) }); });
export const PATCH = guardArea("tickets", async (req) => {
  const { id, reply, status } = (await req.json()) as { id: string; reply?: string; status?: "open" | "answered" | "closed" };
  const t = await answerTicket(id, reply ?? "", status ?? (reply ? "answered" : "open"));
  return t ? Response.json({ ticket: t }) : Response.json({ error: "Not found" }, { status: 404 });
});
