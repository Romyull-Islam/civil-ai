import { TOOLS, runTool, toolJsonSchema } from "@/lib/tools";
import { hasAccounts } from "@/lib/saas/mode";
import { requireVerifiedUser } from "@/lib/saas/service";

export const runtime = "nodejs";

export async function GET() {
  return Response.json(TOOLS.map((t) => ({ name: t.name, category: t.category, description: t.description, schema: toolJsonSchema(t, "openai") })));
}

export async function POST(req: Request) {
  if (hasAccounts()) { const u = await requireVerifiedUser(req); if (u instanceof Response) return u; }
  const { name, input } = (await req.json()) as { name: string; input: unknown };
  const out = await runTool(name, input);
  return Response.json(out, { status: out.error ? 400 : 200 });
}
