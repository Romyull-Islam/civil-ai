import { PROVIDERS, resolveProvider } from "@/lib/ai/registry";
export async function GET() {
  return Response.json({ ok: true, version: process.env.npm_package_version ?? "0.1.0", providersFromEnv: PROVIDERS.filter((p) => resolveProvider(p.id, {})).map((p) => p.id) });
}
