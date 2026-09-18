import { getSessionUser } from "./service";
import { appMode } from "./mode";
import type { Role, User } from "./db";

/** Which roles may use which admin area. */
export const AREA_ROLES: Record<string, Role[]> = {
  users: ["superadmin", "admin", "support"],
  payments: ["superadmin", "admin", "support"],
  tickets: ["superadmin", "admin", "support"],
  keys: ["superadmin", "admin"],
  plans: ["superadmin", "admin"],
  site: ["superadmin", "admin"],
  usage: ["superadmin", "admin"],
  accounts: ["superadmin"], // create/delete staff, change roles
};

export async function requireRole(req: Request, roles: Role[]): Promise<User> {
  if (appMode() !== "saas") throw new Response(JSON.stringify({ error: "Not in SaaS mode" }), { status: 400 });
  const u = await getSessionUser(req);
  if (!u) throw new Response(JSON.stringify({ error: "Sign in required" }), { status: 401 });
  if (!roles.includes(u.role)) throw new Response(JSON.stringify({ error: `Requires role: ${roles.join(" or ")}` }), { status: 403 });
  return u;
}
export const requireAdmin = (req: Request) => requireRole(req, ["superadmin", "admin"]);

export const guardArea = (area: keyof typeof AREA_ROLES, fn: (req: Request, actor: User) => Promise<Response>) => async (req: Request) => {
  try { const actor = await requireRole(req, AREA_ROLES[area]); return await fn(req, actor); }
  catch (e) { if (e instanceof Response) return e; return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
};
export const guard = (fn: (req: Request) => Promise<Response>) => guardArea("keys", (req) => fn(req));
