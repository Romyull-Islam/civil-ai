import { requestPasswordReset } from "@/lib/saas/service";
export const runtime = "nodejs";
const recent = new Map<string, number>();
export async function POST(req: Request) {
  const { email } = (await req.json()) as { email: string };
  const key = String(email ?? "").toLowerCase();
  if (Date.now() - (recent.get(key) ?? 0) < 60000) return Response.json({ ok: true }); // silently throttle
  recent.set(key, Date.now());
  await requestPasswordReset(key).catch(() => {});
  return Response.json({ ok: true, message: "If that email has an account, a reset code has been sent." });
}
