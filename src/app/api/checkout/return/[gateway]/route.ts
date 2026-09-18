/** Gateway return URL (browser redirect; GET with query or POST with form fields). Verifies and redirects the user to /account. */
import { completeCheckout } from "@/lib/saas/checkout";
export const runtime = "nodejs";

async function handle(req: Request, gateway: string) {
  const url = new URL(req.url);
  const params: Record<string, string> = Object.fromEntries(url.searchParams.entries());
  if (req.method === "POST") {
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data")) { const fd = await req.formData(); fd.forEach((v, k) => { params[k] = String(v); }); }
    else if (ct.includes("json")) Object.assign(params, await req.json());
  }
  const pid = params.pid ?? params.tran_id ?? params.mer_txnid ?? params.merchantInvoiceNumber ?? "";
  const base = process.env.NEXT_PUBLIC_APP_URL ?? url.origin;
  const r = pid ? await completeCheckout(gateway, pid, params, base) : { status: "invalid" as const };
  const dest = new URL("/account", base);
  dest.searchParams.set("payment", r.status === "already" ? "paid" : r.status);
  return Response.redirect(dest.toString(), 303);
}
export async function GET(req: Request, ctx: { params: Promise<{ gateway: string }> }) { return handle(req, (await ctx.params).gateway); }
export async function POST(req: Request, ctx: { params: Promise<{ gateway: string }> }) { return handle(req, (await ctx.params).gateway); }
