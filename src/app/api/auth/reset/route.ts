import { resetPassword } from "@/lib/saas/service";
export const runtime = "nodejs";
export async function POST(req: Request) {
  try { const { email, code, password } = (await req.json()) as { email: string; code: string; password: string }; await resetPassword(email, code, password); return Response.json({ ok: true }); }
  catch (e) { return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 }); }
}
