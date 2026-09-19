/** Build an .xlsx from a workbook spec (calculator tables, cost estimates, schedules). */
import { buildWorkbook, type WorkbookSpec } from "@/lib/docs/xlsx";
import { rateLimit, clientIp } from "@/lib/saas/security";
export const runtime = "nodejs";
export async function POST(req: Request) {
  if (!rateLimit(`xlsx:${clientIp(req)}`, 60, 10 * 60000)) return Response.json({ error: "Too many exports; try again shortly." }, { status: 429 });
  const spec = (await req.json().catch(() => null)) as WorkbookSpec | null;
  if (!spec || !Array.isArray(spec.sheets) || !spec.sheets.length || spec.sheets.length > 10) return Response.json({ error: "Invalid workbook" }, { status: 400 });
  if (spec.sheets.some((s) => !Array.isArray(s.rows) || s.rows.length > 5000 || s.rows.some((r) => !Array.isArray(r) || r.length > 400) || (s.fills?.length ?? 0) > 5000)) return Response.json({ error: "Workbook too large" }, { status: 400 });
  if (JSON.stringify(spec).length > 8_000_000) return Response.json({ error: "Workbook too large" }, { status: 400 });
  const buf = await buildWorkbook(spec);
  const name = (spec.title || "civilmate").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "civilmate";
  return new Response(new Uint8Array(buf), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${name}.xlsx"` } });
}
