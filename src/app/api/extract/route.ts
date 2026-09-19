/** Extract text from an attached document (PDF, Word, Excel, CSV, text). Signed-in users only (proxy); rate limited. */
import { extractDocument, MAX_UPLOAD_BYTES } from "@/lib/docs/extract";
import { rateLimit, clientIp } from "@/lib/saas/security";
import { getSessionUser } from "@/lib/saas/service";
import { hasAccounts } from "@/lib/saas/mode";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(req: Request) {
  const user = hasAccounts() ? await getSessionUser(req) : null;
  if (hasAccounts() && !user) return Response.json({ error: "Sign in first" }, { status: 401 });
  if (!rateLimit(`extract:${user?.id ?? clientIp(req)}`, 30, 10 * 60000)) return Response.json({ error: "Too many uploads; try again in a few minutes." }, { status: 429 });
  const fd = await req.formData().catch(() => null);
  const file = fd?.get("file");
  if (!file || typeof file === "string") return Response.json({ error: "No file" }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) return Response.json({ error: `File is larger than ${MAX_UPLOAD_BYTES / 1048576} MB` }, { status: 413 });
  try {
    const doc = await extractDocument(Buffer.from(await file.arrayBuffer()), file.name, file.type);
    return Response.json({ document: doc });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Could not read this file" }, { status: 400 });
  }
}
