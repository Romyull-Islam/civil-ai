"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Markdown } from "@/components/Markdown";

export default function Page() {
  const [site, setSite] = useState<{ privacy: string; appName: string; companyName: string; companyAddress: string; supportEmail: string } | null>(null);
  useEffect(() => { fetch("/api/site").then((r) => r.json()).then((j) => setSite(j.site)); }, []);
  return (
    <div className="h-full overflow-y-auto"><div className="max-w-3xl mx-auto p-6 grid gap-4">
      <h1 className="text-lg font-semibold">Privacy Policy</h1>
      {site && <div className="card p-5"><Markdown text={site.privacy} />{(site.companyName || site.companyAddress || site.supportEmail) && <p className="text-xs text-muted mt-4">{site.companyName}{site.companyAddress ? ` · ${site.companyAddress}` : ""}{site.supportEmail ? ` · ${site.supportEmail}` : ""}</p>}</div>}
      <div className="text-xs text-muted flex gap-3"><Link className="text-accent2" href="/terms">Terms</Link><Link className="text-accent2" href="/privacy">Privacy</Link><Link className="text-accent2" href="/refund-policy">Refunds</Link><Link className="text-accent2" href="/help">Help</Link></div>
    </div></div>
  );
}
