/** Company edition: licence, per-user AI limits and allowed models (Admin → Company). */
import { guardArea } from "@/lib/saas/admin";
import { isCompany } from "@/lib/saas/mode";
import { getCompanySettings, setCompanySettings, companyModels, DEFAULT_COMPANY, type CompanySettings } from "@/lib/company";
import { licenseState, saveLicense } from "@/lib/company/license";
import { getDB } from "@/lib/saas/db";
import { audit } from "@/lib/saas/security";
export const runtime = "nodejs";

const notCompany = () => Response.json({ error: "Only used in the company edition" }, { status: 400 });

export const GET = guardArea("site", async () => {
  if (!isCompany()) return notCompany();
  const settings = await getCompanySettings();
  const [license, available, users] = await Promise.all([licenseState(), companyModels({ ...DEFAULT_COMPANY, models: [], defaultModel: "" }), (await getDB()).listUsers()]);
  return Response.json({ settings, license, availableModels: available.map((m) => `${m.provider}/${m.model}`), activeUsers: users.filter((u) => !u.disabled).length });
});

export const PUT = guardArea("site", async (req, actor) => {
  if (!isCompany()) return notCompany();
  const body = (await req.json().catch(() => ({}))) as { settings?: CompanySettings; license?: string };
  try {
    if (body.license !== undefined) { const p = await saveLicense(body.license); await audit(actor.id, "company.license", p.company, `${p.seats} seats, expires ${p.expires ?? "never"}`); }
    if (body.settings) { const s = await setCompanySettings(body.settings); await audit(actor.id, "company.settings", "", JSON.stringify(s)); }
  } catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
  return Response.json({ settings: await getCompanySettings(), license: await licenseState() });
});
