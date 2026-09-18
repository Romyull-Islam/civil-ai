import { getCloudLink, cloudMe } from "@/lib/saas/cloud";
export const runtime = "nodejs";
export async function GET() {
  const link = await getCloudLink();
  if (!link) return Response.json({ linked: false });
  try { const me = await cloudMe(link); return Response.json({ linked: true, backendUrl: link.backendUrl, email: link.email, ...me }); }
  catch { return Response.json({ linked: true, backendUrl: link.backendUrl, email: link.email, offline: true }); }
}
