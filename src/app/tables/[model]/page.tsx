import Link from "next/link";
import { notFound } from "next/navigation";
import { Shell } from "@/components/Shell";
import { Card, Empty } from "@/components/ui";
import { tableMeta, listRows } from "@/lib/tables";
import { prisma } from "@/lib/prisma";
import { canSeeModel, canWriteModel } from "@/lib/branch";
import { currentUser } from "@/lib/rbac";
import { operatorTableModels } from "@/lib/stationAccess";

export const dynamic = "force-dynamic";

function cell(v: unknown): string {
  if (v == null) return "—";
  if (v instanceof Date) return v.toISOString().slice(0, 16).replace("T", " ");
  if (Array.isArray(v)) return v.length ? `${v.length} linked` : "—";
  if (typeof v === "object") return "{…}";
  const s = String(v);
  return s.length > 40 ? s.slice(0, 40) + "…" : s;
}

// Mixer-cycle link arrays on a Silo bag row (reverse links of the cycle's silo pickers).
const USAGE_KEY = /^m[1-4]G[1-5]Ids$/;
function usageIds(row: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(row)) {
    if ((USAGE_KEY.test(k) || k === "fillerSiloIdIds") && Array.isArray(v)) out.push(...(v as string[]));
  }
  return out;
}

export default async function TableGrid({ params, searchParams }: { params: Promise<{ model: string }>; searchParams: Promise<{ page?: string; b?: string; silo?: string; from?: string; q?: string; sort?: string; dir?: string }>; }) {
  const { model } = await params;
  const sp = await searchParams;
  const meta = tableMeta(model);
  if (!meta) notFound();
  if (!(await canSeeModel(model))) notFound();
  const me = await currentUser();
  const isOperator = String((me as { role?: string } | null)?.role ?? "") === "OPERATOR";
  if (isOperator && !operatorTableModels((me as { station?: string | null } | null)?.station).has(model)) notFound();
  const writable = !isOperator && (await canWriteModel(model)); // operators: view-only EXCEPT their own entries
  const myId = String((me as { id?: string } | null)?.id ?? "");

  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const batch = sp.b?.trim() || undefined;
  const q = sp.q?.trim() || undefined;
  const sort = sp.sort?.trim() || undefined;
  const dir: "asc" | "desc" = sp.dir === "asc" ? "asc" : "desc";
  const isSilo = model === "Silo";
  const STATIONS_T = new Set(["Press", "Oven", "Jot", "Distributor", "Kreos", "PolishEntry", "PolishQc", "MixerCycle"]);
  const colLabel = (f: { prismaField: string; airtableName: string }) =>
    STATIONS_T.has(model) && f.prismaField === "date" ? "Created Time" : f.airtableName;
  const cols = meta.fields
    .filter((f) => ["scalar", "number", "int", "bool", "date", "multiselect"].includes(f.kind))
    .filter((f) => f.prismaField !== "createdTime") // Airtable metadata — empty for app-entered rows
    .slice(0, 6);
  let siloCols = cols.filter((c) => c.prismaField !== "sku" && !/sku/i.test(c.airtableName));
  // Silo rows are BAGS — always show which invoice/bag each row is
  if (isSilo && !siloCols.some((c) => c.prismaField === "invNoBagNo")) {
    const invBag = meta.fields.find((f) => f.prismaField === "invNoBagNo");
    if (invBag) siloCols = [siloCols[0], invBag, ...siloCols.slice(1)].slice(0, 6);
  }
  const mainCols = isSilo ? siloCols : cols;

  const silo = sp.silo?.trim();
  // back target: only allow internal paths
  const from = sp.from && sp.from.startsWith("/") ? sp.from : undefined;
  let pinned: Record<string, unknown>[] = [];
  if (isSilo && silo) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    try { pinned = await (prisma as any).silo.findMany({ where: { siloNo: silo, remainingWeight: { gt: 0 } }, orderBy: { siloIncrement: "desc" }, take: 60 }); } catch { /* ignore */ }
  }

  let data;
  let error: string | null = null;
  try { data = await listRows(model, page, 25, batch, q, sort, dir); }
  catch { error = "Could not read this table."; }

  // Resolve which mixer cycle (batch · cycle) each bag was used in.
  const cycleMap = new Map<string, string>();
  if (isSilo) {
    const ids = new Set<string>();
    for (const r of [...pinned, ...(data?.rows ?? [])]) for (const id of usageIds(r)) ids.add(id);
    if (ids.size) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cycles = await (prisma as any).mixerCycle.findMany({ where: { airtableId: { in: [...ids] } }, select: { airtableId: true, batch: true, cycle: true } });
        for (const c of cycles) cycleMap.set(c.airtableId, `${c.batch ?? "?"} · C${c.cycle == null ? "?" : Math.round(c.cycle)}`);
      } catch { /* migration pending */ }
    }
  }
  const usedIn = (row: Record<string, unknown>): string => {
    const labels = [...new Set(usageIds(row).map((id) => cycleMap.get(id)).filter(Boolean))] as string[];
    if (!labels.length) return "—";
    return labels.slice(0, 3).join(", ") + (labels.length > 3 ? ` +${labels.length - 3} more` : "");
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const SORTABLE = new Set(["scalar", "number", "int", "bool", "date"]);
  const base = (p: number) => `/tables/${model}?page=${p}${batch ? `&b=${encodeURIComponent(batch)}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}${silo ? `&silo=${encodeURIComponent(silo)}` : ""}${from ? `&from=${encodeURIComponent(from)}` : ""}`;
  const qp = (p: number) => `${base(p)}${sort ? `&sort=${encodeURIComponent(sort)}&dir=${dir}` : ""}`;
  const sortHref = (field: string) => `${base(1)}&sort=${encodeURIComponent(field)}&dir=${sort === field && dir === "asc" ? "desc" : "asc"}`;

  return (
    <Shell>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <Link href={from || "/tables"} className="text-sm text-brand hover:underline">{from ? "← Back to form" : "← Tables"}</Link>
          <h1 className="text-xl font-semibold">{meta.tableName}</h1>
        </div>
        {writable ? <Link href={`/tables/${model}/new`} className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark">+ New record</Link> : <span className="rounded-md bg-gray-100 px-3 py-1.5 text-sm text-gray-500">View only</span>}
      </div>

      {error && <Empty>{error}</Empty>}

      {pinned.length > 0 && (
        <Card className="mb-4 border-amber-200 bg-amber-50/50">
          <div className="mb-2 text-sm font-semibold text-amber-800">Silo {silo} — remaining bags · {pinned.length}</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-gray-500">
                {siloCols.map((c) => <th key={c.prismaField} className="whitespace-nowrap py-2 pr-4">{colLabel(c)}</th>)}
                <th className="whitespace-nowrap py-2 pr-4">Remaining (kg)</th>
                <th className="whitespace-nowrap py-2 pr-4">Used in (batch · cycle)</th>
                <th></th>
              </tr></thead>
              <tbody>
                {pinned.map((row, i) => (
                  <tr key={i} className="border-t border-amber-100 bg-amber-50/60">
                    {siloCols.map((c) => <td key={c.prismaField} className="whitespace-nowrap py-2 pr-4">{cell(row[c.prismaField])}</td>)}
                    <td className="whitespace-nowrap py-2 pr-4 font-medium text-amber-900">{typeof row.remainingWeight === "number" ? Math.round(row.remainingWeight * 100) / 100 : cell(row.remainingWeight)}</td>
                    <td className="whitespace-nowrap py-2 pr-4">{usedIn(row)}</td>
                    <td className="py-2 text-right"><Link href={`/tables/${model}/${row.id}`} className="font-medium text-brand hover:underline">{writable ? "Edit →" : "View →"}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <form method="GET" className="mb-4 flex flex-wrap items-center gap-2">
        {batch && <input type="hidden" name="b" value={batch} />}
        {silo && <input type="hidden" name="silo" value={silo} />}
        {from && <input type="hidden" name="from" value={from} />}
        {sort && <input type="hidden" name="sort" value={sort} />}
        {sort && <input type="hidden" name="dir" value={dir} />}
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search this table — slab no, invoice, design, operator…"
          className="min-h-[44px] w-full max-w-md rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
        />
        <button className="min-h-[44px] rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-black">Search</button>
        {q && <Link href={qp(1).replace(/&q=[^&]*/, "")} className="text-sm text-brand hover:underline">Clear</Link>}
      </form>

      {!error && data && (
        <Card>
          <div className="mb-3 text-sm text-gray-500">{data.total.toLocaleString()} records{q ? ` matching “${q}”` : ""} · page {page} of {totalPages}</div>
          {data.rows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-gray-500">
                  {mainCols.map((c) => <th key={c.prismaField} className="whitespace-nowrap py-2 pr-4">{SORTABLE.has(c.kind) ? <Link href={sortHref(c.prismaField)} className="inline-flex items-center gap-1 hover:text-gray-700">{colLabel(c)}{sort === c.prismaField && <span className="text-[9px]">{dir === "asc" ? "\u2191" : "\u2193"}</span>}</Link> : colLabel(c)}</th>)}
                  {isSilo && <th className="whitespace-nowrap py-2 pr-4">Used in (batch · cycle)</th>}
                  <th></th>
                </tr></thead>
                <tbody>
                  {data.rows.map((row, i) => (
                    <tr key={i} className="border-t border-gray-100">
                      {mainCols.map((c) => <td key={c.prismaField} className="whitespace-nowrap py-2 pr-4">{cell(row[c.prismaField])}</td>)}
                      {isSilo && <td className="whitespace-nowrap py-2 pr-4">{usedIn(row)}</td>}
                      <td className="py-2 text-right"><Link href={`/tables/${model}/${row.id}`} className="text-brand hover:underline">{writable || (isOperator && (model === "PolishQc" || (myId && (row as { enteredById?: string | null }).enteredById === myId))) ? "Edit →" : "View →"}</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty>No records.</Empty>}
          <div className="mt-4 flex items-center justify-between gap-3 text-sm">
            <Link href={qp(Math.max(1, page - 1))} className={`min-h-[44px] content-center rounded-md border px-3 py-1.5 ${page <= 1 ? "pointer-events-none border-gray-100 text-gray-300" : "border-gray-300 text-gray-700 hover:bg-gray-50"}`}>← Prev</Link>
            <form method="GET" className="flex items-center gap-2 text-gray-500">
              {batch && <input type="hidden" name="b" value={batch} />}
              {q && <input type="hidden" name="q" value={q} />}
              {silo && <input type="hidden" name="silo" value={silo} />}
              {from && <input type="hidden" name="from" value={from} />}
              {sort && <input type="hidden" name="sort" value={sort} />}
              {sort && <input type="hidden" name="dir" value={dir} />}
              <span>Page</span>
              <input name="page" type="number" min={1} max={totalPages} defaultValue={page} className="w-20 rounded-md border border-gray-300 px-2 py-1.5 text-center text-sm" />
              <span>of {totalPages}</span>
              <button className="rounded-md border border-gray-300 px-3 py-1.5 text-gray-700 hover:bg-gray-50">Go</button>
            </form>
            <Link href={qp(Math.min(totalPages, page + 1))} className={`min-h-[44px] content-center rounded-md border px-3 py-1.5 ${page >= totalPages ? "pointer-events-none border-gray-100 text-gray-300" : "border-gray-300 text-gray-700 hover:bg-gray-50"}`}>Next →</Link>
          </div>
        </Card>
      )}
    </Shell>
  );
}
