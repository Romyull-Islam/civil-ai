import { Suspense } from "react";
import { Chat } from "@/components/Chat";
export default function Page() { return <Suspense fallback={<div className="p-6 text-sm text-muted">Loading…</div>}><Chat /></Suspense>; }
