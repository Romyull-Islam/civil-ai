"use client";
import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { useSession, accountsMode } from "@/lib/client/session";
import { UsageBars } from "@/components/UsageBars";
import { useNow } from "@/lib/client/now";

/** Usage page (profile menu → Usage): session, weekly and monthly limits with reset times, like Claude plans. */
export default function UsagePage() {
  const s = useSession();
  const now = useNow(30000);
  if (!s) return <div className="p-6 text-sm text-muted">Loading…</div>;
  if (!accountsMode(s)) return <div className="p-6 text-sm text-muted">Usage limits apply to the online service only. The offline model in this app is unlimited.</div>;
  if (!s.user) return <div className="p-6 text-sm">Please <Link className="text-accent2" href="/login?next=/usage">sign in</Link>.</div>;
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto p-6 grid gap-4">
        <div className="flex items-center gap-2"><BarChart3 className="text-accent" /><h1 className="text-lg font-semibold">Usage</h1><span className="badge ml-2">{s.plan?.name} plan</span></div>
        {s.usage ? <div className="card p-5"><UsageBars usage={s.usage} now={now} /></div> : <div className="card p-5 text-sm text-muted">No usage yet.</div>}
        <div className="card p-4 text-sm grid gap-2">
          <div className="font-medium">How credits work</div>
          <ul className="text-muted text-xs grid gap-1 list-disc pl-4">
            <li>Each answer costs credits according to the model and how much it reads and writes. The model chooser under the chat box shows the typical cost of each model.</li>
            <li>A session lasts {s.usage?.sessionHours ?? 5} hours from your first question. Weeks count from the start of your plan period.</li>
            <li>An answer that has started always finishes, even if it goes slightly over a limit.</li>
          </ul>
          <div className="flex flex-wrap gap-2 mt-1"><Link className="btn btn-sm" href="/billing#credits">Buy extra credits</Link><Link className="btn btn-sm" href="/subscribe">{s.plan?.id === "free" ? "Upgrade plan" : "Change plan"}</Link></div>
        </div>
      </div>
    </div>
  );
}
