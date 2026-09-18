import { setCloudLink } from "@/lib/saas/cloud";
export const runtime = "nodejs";
export async function POST() { await setCloudLink(null); return Response.json({ ok: true }); }
