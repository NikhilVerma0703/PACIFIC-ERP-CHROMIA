"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const QUEUES: { type: string; href: string; label: string; dot: string }[] = [
  { type: "CUTTING", href: "/fab/cutting", label: "Cutting", dot: "bg-blue-500" },
  { type: "POLISHING", href: "/fab/polishing", label: "Polishing", dot: "bg-violet-500" },
  { type: "SINK_CUTTING", href: "/fab/sink-cutting", label: "Sink Cutting", dot: "bg-orange-500" },
  { type: "FABRICATION", href: "/fab/fabrication", label: "Fabrication", dot: "bg-rose-500" },
  { type: "PACKAGING", href: "/fab/packaging", label: "Packaging", dot: "bg-green-500" },
];

export function OperatorQueueNav() {
  const path = usePathname();
  return (
    <nav className="flex flex-col gap-1 flex-1">
      <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500 px-3 mb-1.5">Queues</p>
      {QUEUES.map(q => {
        const isCurrent = path === q.href;
        return (
          <Link key={q.type} href={q.href}
            className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition ${
              isCurrent ? "bg-white/10 text-white" : "text-slate-400 hover:text-white hover:bg-white/5"
            }`}>
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${q.dot}`} />
            {q.label}
          </Link>
        );
      })}
      <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500 px-3 mt-4 mb-1.5">Floor</p>
      <Link href="/fab/downtime"
        className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition ${
          path === "/fab/downtime" ? "bg-white/10 text-white" : "text-slate-400 hover:text-white hover:bg-white/5"
        }`}>
        <span className="w-2 h-2 rounded-full flex-shrink-0 bg-red-500" />
        Downtime
      </Link>
    </nav>
  );
}
