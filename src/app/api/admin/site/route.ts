import { guardArea } from "@/lib/saas/admin";
import { getSite, setSite, type SiteSettings } from "@/lib/saas/site";
import { emailConfigured } from "@/lib/saas/email";
export const runtime = "nodejs";
export const GET = guardArea("site", async () => Response.json({ site: await getSite(), emailConfigured: emailConfigured() }));
export const POST = guardArea("site", async (req) => {
  const { site } = (await req.json()) as { site: SiteSettings };
  if (site.payment?.qrImage && site.payment.qrImage.length > 600000) return Response.json({ error: "QR image too large (max ~450 KB)" }, { status: 400 });
  await setSite(site);
  return Response.json({ site: await getSite() });
});
