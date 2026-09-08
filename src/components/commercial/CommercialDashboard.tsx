"use client";
// The Commercial overview: counts by stage, holds about to lapse, the
// production queue, and the latest activity. Reads /api/office/commercial/
// dashboard; every figure links to the list it counts.
import Link from "next/link";
import { useEffect, useState } from "react";
import { Card, Kpi, Badge, Empty } from "@/components/ui";
import { readJson } from "@/lib/readJson";

interface Dashboard {
  enquiries: { open: number };
  orders: { byStatus: Record<string, number>; total: number };
  holds: { active: number; expiringSoon: Array<{ id: string; reference: string; customer: string | null; expiresAt: string; slabs: number; orderId: string | null }> };
  queue: { queued: number; inProduction: number; notScheduled: number };
  packing: { submitted: number };
  receipts: { awaitingAdvance: number };
  recent: Array<{ id: string; orderId: string; orderNumber: string; kind: string; note: string | null; byName: string | null; at: string }>;
}

const STAGE_LABEL: Record<string, string> = {
  DRAFT: "Draft", CONFIRMED: "Confirmed", STOCK_CHECKED: "Stock checked", PI_ISSUED: "PI issued", PACKING: "Packing",
  DISPATCH_CHECK: "Dispatch check", READY: "Ready", INVOICED: "Invoiced", DISPATCHED: "Dispatched", CLOSED: "Closed", CANCELLED: "Cancelled",
};

export function CommercialDashboard({ actions }: { actions: string[] }) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await fetch("/api/office/commercial/dashboard", { cache: "no-store" });
      const res = await readJson<Dashboard>(r);
      if (!alive) return;
      if (!res.ok) setError(res.error ?? "Could not load the overview");
      else setData(res.data);
    })();
    return () => { alive = false; };
  }, []);

  if (error) return <Empty>{error}</Empty>;
  if (!data) return <Empty>Loading…</Empty>;

  const open = Object.entries(data.orders.byStatus).filter(([k]) => k !== "CLOSED" && k !== "CANCELLED").reduce((a, [, n]) => a + n, 0);
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        <Link href="/office/commercial/enquiries"><Kpi label="Open enquiries" value={data.enquiries.open} /></Link>
        <Link href="/office/commercial/orders"><Kpi label="Open orders" value={open} sub={`${data.orders.total} in all`} /></Link>
        {/* NOT A LINK. It used to carry ?tab=holds to the orders board, which
            has no such tab: the board ignored the parameter, stripped it from
            the address bar, and the reader who clicked "14 active holds" landed
            on every order with no hold in sight. There is no holds list page —
            a hold is read on its order's Stock tab — so the figure states
            itself and the card below carries the links that work. */}
        <Kpi
          label="Active holds"
          value={data.holds.active}
          sub={data.holds.expiringSoon.length ? `${data.holds.expiringSoon.length} lapse within 48h` : undefined}
          working="Slabs reserved against an order or enquiry and not yet packed, released or lapsed. The ones lapsing soonest are listed below; open a hold on its order's Stock tab."
        />
        <Link href="/office/commercial/production-planning"><Kpi label="Production queue" value={data.queue.queued} sub={data.queue.inProduction ? `${data.queue.inProduction} running` : undefined} /></Link>
        <Link href={actions.includes("verify") ? "/office/commercial/dispatch-check" : "/office/commercial/packing-lists"}><Kpi label="Awaiting dispatch check" value={data.packing.submitted} /></Link>
        {/* NOT WRAPPED IN A LINK, either of these two. A Kpi with `working`
            renders a <details>; inside a next/link anchor the click on its
            summary is swallowed (Link preventDefaults and navigates), so the
            explanation could never open — the one tile that most needs one.
            The destination lives inside the explanation instead. */}
        <Kpi
          label="Planned but not scheduled"
          value={data.queue.notScheduled}
          working={(
            <>
              Reductions made on the planning page that nobody has added back or removed yet (answer 13). Each one is slabs an
              order asked for that the plant has not been told to make.{" "}
              <Link href="/office/commercial/production-planning" className="font-medium text-brand hover:underline">Open production planning →</Link>
            </>
          )}
        />
        {/* The orders board filters by one status at a time and this figure
            spans two, so the link opens the board unfiltered and the text says
            what was counted; the Receipts card on each order is where the
            advance goes. */}
        <Kpi
          label="Waiting for an advance"
          value={data.receipts.awaitingAdvance}
          working={(
            <>
              Orders at Ready or Invoiced with no ADVANCE receipt recorded. Dispatch refuses these until one is (answer 2);
              record it on the order&apos;s Receipts card.{" "}
              <Link href="/office/commercial/orders" className="font-medium text-brand hover:underline">Open the orders board →</Link>
            </>
          )}
        />
      </div>

      <Card>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Orders by stage</h2>
        <div className="flex flex-wrap gap-2">
          {Object.keys(STAGE_LABEL).map((k) => (
            <Link key={k} href={`/office/commercial/orders?status=${k}`} className="rounded-lg border border-gray-200 px-3 py-2 text-sm hover:border-brand">
              <span className="text-gray-500">{STAGE_LABEL[k]}</span>
              <span className="ml-2 font-semibold text-gray-900">{data.orders.byStatus[k] ?? 0}</span>
            </Link>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Holds lapsing within 48 hours</h2>
          {data.holds.expiringSoon.length === 0 ? <div className="text-sm text-gray-500">None.</div> : (
            <ul className="divide-y divide-gray-100 text-sm">
              {data.holds.expiringSoon.map((h) => (
                <li key={h.id} className="flex items-center justify-between py-2">
                  <div>
                    <Link href={h.orderId ? `/office/commercial/orders/${h.orderId}?tab=stock` : "/office/commercial/orders"} className="font-medium text-brand hover:underline">{h.reference}</Link>
                    <span className="ml-2 text-gray-500">{h.customer ?? ""}</span>
                  </div>
                  <div className="text-right">
                    <div>{h.slabs} slabs</div>
                    <div className="text-xs text-gray-400">{new Date(h.expiresAt).toLocaleString("en-IN")}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Latest activity</h2>
          {data.recent.length === 0 ? <div className="text-sm text-gray-500">Nothing yet.</div> : (
            <ul className="divide-y divide-gray-100 text-sm">
              {data.recent.map((e) => (
                <li key={e.id} className="py-2">
                  <div className="flex items-center justify-between gap-2">
                    <Link href={`/office/commercial/orders/${e.orderId}`} className="font-medium text-brand hover:underline">{e.orderNumber}</Link>
                    <Badge>{e.kind.replace(/_/g, " ")}</Badge>
                  </div>
                  <div className="text-xs text-gray-500">{e.note ?? ""} {e.byName ? `· ${e.byName}` : ""} · {new Date(e.at).toLocaleString("en-IN")}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
