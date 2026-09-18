/** SSLCommerz IPN (server-to-server). Validates val_id with the validation API before activating. */
import { completeCheckout } from "@/lib/saas/checkout";
export const runtime = "nodejs";
export async function POST(req: Request) {
  const fd = await req.formData();
  const params: Record<string, string> = {}; fd.forEach((v, k) => { params[k] = String(v); });
  const base = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;
  const r = params.tran_id ? await completeCheckout("sslcommerz", params.tran_id, { ...params, outcome: "success" }, base) : { status: "invalid" };
  return Response.json(r);
}
