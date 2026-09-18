import { guardArea } from "@/lib/saas/admin";
import { getDB } from "@/lib/saas/db";
import { publicUser } from "@/lib/saas/service";
import { newId } from "@/lib/saas/crypto";
import { audit } from "@/lib/saas/security";
export const runtime = "nodejs";
export const GET = guardArea("users", async () => { const db = await getDB(); const teams = await db.listTeams(); const out = []; for (const t of teams) { const owner = await db.getUserById(t.ownerId); out.push({ ...t, ownerEmail: owner?.email, members: (await db.listTeamMembers(t.id)).map(publicUser) }); } return Response.json({ teams: out }); });
export const POST = guardArea("users", async (req, actor) => {
  const { ownerEmail, name, plan, seats, expires } = (await req.json()) as { ownerEmail: string; name?: string; plan: string; seats: number; expires?: number | null };
  const db = await getDB();
  const owner = await db.getUserByEmail(ownerEmail);
  if (!owner) return Response.json({ error: "Owner account not found" }, { status: 404 });
  if (await db.getTeamByOwner(owner.id)) return Response.json({ error: "This user already owns a team" }, { status: 400 });
  const t = { id: newId(), name: name || `${owner.name || owner.email}'s team`, ownerId: owner.id, plan, seats: Math.max(1, Number(seats) || 1), expires: expires ?? null, createdAt: Date.now() };
  await db.createTeam(t);
  await audit(actor.id, "team.create", owner.email, `${plan} seats=${t.seats}`);
  return Response.json({ team: t }, { status: 201 });
});
export const PATCH = guardArea("users", async (req, actor) => {
  const { id, plan, seats, expires, name, remove } = (await req.json()) as { id: string; plan?: string; seats?: number; expires?: number | null; name?: string; remove?: boolean };
  const db = await getDB();
  const t = await db.getTeam(id);
  if (!t) return Response.json({ error: "Not found" }, { status: 404 });
  if (remove) { await db.deleteTeam(id); await audit(actor.id, "team.delete", t.name); return Response.json({ ok: true }); }
  await db.updateTeam(id, { plan, seats, expires, name });
  await audit(actor.id, "team.update", t.name, JSON.stringify({ plan, seats, expires }));
  return Response.json({ team: await db.getTeam(id) });
});
