import { guardArea } from "@/lib/saas/admin";
import { getDB, ROLES, type Role } from "@/lib/saas/db";
import { publicUser, getPlans, createAccount } from "@/lib/saas/service";
import { hashPassword } from "@/lib/saas/crypto";
import { audit } from "@/lib/saas/security";
export const runtime = "nodejs";

export const GET = guardArea("users", async () => { const db = await getDB(); return Response.json({ users: (await db.listUsers()).map(publicUser), plans: await getPlans(), roles: ROLES }); });

/** Plan/expiry/disable/password: staff. Role changes: superadmin only. */
export const PATCH = guardArea("users", async (req, actor) => {
  const { id, plan, role, planExpires, disabled, password } = (await req.json()) as { id: string; plan?: string; role?: Role; planExpires?: number | null; disabled?: number; password?: string };
  const db = await getDB();
  const target = await db.getUserById(id);
  if (!target) return Response.json({ error: "Not found" }, { status: 404 });
  if (role !== undefined && role !== target.role) {
    if (actor.role !== "superadmin") return Response.json({ error: "Only the superadmin can change roles" }, { status: 403 });
    if (!ROLES.includes(role)) return Response.json({ error: "Invalid role" }, { status: 400 });
    if (target.id === actor.id && role !== "superadmin") return Response.json({ error: "You cannot demote yourself" }, { status: 400 });
  }
  if (target.role === "superadmin" && actor.role !== "superadmin") return Response.json({ error: "Only a superadmin can modify a superadmin" }, { status: 403 });
  if (disabled && target.id === actor.id) return Response.json({ error: "You cannot disable yourself" }, { status: 400 });
  await db.updateUser(id, { plan, role, planExpires, disabled, passwordHash: password ? hashPassword(password) : undefined });
  await audit(actor.id, "user.update", target.email, JSON.stringify({ plan, role, planExpires, disabled, password: password ? "changed" : undefined }));
  const u = await db.getUserById(id);
  return Response.json({ user: u ? publicUser(u) : null });
});

/** Superadmin: create a staff/user account with a temporary password (emailed when email is configured). */
const guardActor = (req: Request) => import("@/lib/saas/service").then((m) => m.getSessionUser(req)).then((u) => u!);
export const POST = guardArea("accounts", async (req) => {
  try {
    const { email, password, role, name } = (await req.json()) as { email: string; password: string; role: Role; name?: string };
    if (!ROLES.includes(role)) return Response.json({ error: "Invalid role" }, { status: 400 });
    const u = await createAccount(email, password, role, name);
    await audit((await guardActor(req)).id, "user.create", u.email, role);
    return Response.json({ user: publicUser(u) }, { status: 201 });
  } catch (e) { return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 }); }
});

/** Superadmin: delete an account (never yourself). */
export const DELETE = guardArea("accounts", async (req, actor) => {
  const { id } = (await req.json()) as { id: string };
  if (id === actor.id) return Response.json({ error: "You cannot delete your own account" }, { status: 400 });
  const db = await getDB();
  const target = await db.getUserById(id);
  if (!target) return Response.json({ error: "Not found" }, { status: 404 });
  await db.deleteUser(id);
  await audit(actor.id, "user.delete", target.email, target.role);
  return Response.json({ ok: true });
});
