import type { ReactNode } from "react";

export function Card({ children, className = "", hover = false }: { children: ReactNode; className?: string; hover?: boolean }) {
  return (
    <div className={`rounded-2xl border border-gray-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)] ${hover ? "card-hover cursor-pointer" : ""} ${className}`}>
      {children}
    </div>
  );
}

export function H2({ children }: { children: ReactNode }) {
  return <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">{children}</h2>;
}

export function Kpi({ label, value, sub, working, className = "" }: {
  label: string; value: ReactNode; sub?: string;
  /** THE ARITHMETIC, on demand. A figure that reads wrong to somebody who does
   *  the obvious division is worse than no figure: the owner divided 4,999 A by
   *  5,299 graded, got 94.3%, and reasonably asked why the card said 96.0%.
   *  Both were right — the card is the GOOD-SLAB share, where a B counts a half
   *  — but nothing on screen said so. Anything whose derivation is not obvious
   *  should carry it here.
   *
   *  A <details>, deliberately: it needs no client JavaScript, so a server
   *  component can render it and it works on the floor tablets. */
  working?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={`flex h-full flex-col ${className}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</div>
        {working && (
          <details className="group relative shrink-0">
            <summary
              className="flex h-5 w-5 cursor-pointer list-none items-center justify-center rounded-full border border-gray-300 text-[10px] font-semibold text-gray-400 transition hover:border-brand hover:text-brand"
              aria-label={`How ${label} is worked out`} title={`How ${label} is worked out`}
            >i</summary>
            <div className="absolute right-0 top-6 z-20 w-64 rounded-lg border border-gray-200 bg-white p-3 text-left text-xs leading-relaxed text-gray-600 shadow-lg">
              {working}
            </div>
          </details>
        )}
      </div>
      <div className="mt-1.5 text-3xl font-semibold tracking-tight text-gray-900">{value}</div>
      {sub && <div className="mt-auto pt-1 text-xs text-gray-400">{sub}</div>}
    </Card>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-gray-300 bg-white/50 p-8 text-center text-sm text-gray-500">{children}</div>;
}

export function Badge({ children, tone = "brand" }: { children: ReactNode; tone?: "brand" | "green" | "amber" | "red" }) {
  const tones = { brand: "bg-brand/10 text-brand", green: "bg-green-100 text-green-700", amber: "bg-amber-100 text-amber-700", red: "bg-red-100 text-red-700" };
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

export function fmt(n: number, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}
