import { getSessionUser, myTeam, addTeamMember, removeTeamMember } from "@/lib/saas/service";
export const runtime = "nodejs";
export async function GET(req: Request) { const u = await getSessionUser(req); if (!u) return Response.json({ error: "Sign in first" }, { status: 401 }); return Response.json({ team: await myTeam(u) }); }
export async function POST(req: Request) {
  const u = await getSessionUser(req); if (!u) return Response.json({ error: "Sign in first" }, { status: 401 });
  try {
    const { action, email, userId } = (await req.json()) as { action: "add" | "remove"; email?: string; userId?: string };
    if (action === "add") await addTeamMember(u, String(email ?? ""));
    else if (action === "remove") await removeTeamMember(u, String(userId ?? ""));
    return Response.json({ team: await myTeam(u) });
  } catch (e) { return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 }); }
}
