import { Shell } from "@/components/Shell";
import { Card, Empty } from "@/components/ui";
import { listRecords, RECORD_VIEWS, type RecordView } from "@/lib/erp";

export const dynamic = "force-dynamic";

function cell(v: unknown): string {
  if (v == null) return "—";
  if (v instanceof Date) return v.toISOString().slice(0, 16).replace("T", " ");
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  if (typeof v === "object") return JSON.stringify(v).slice(0, 40);
  if (typeof v === "string" && /^\d{4}-\d\d-\d\dT/.test(v)) return v.slice(0, 16).replace("T", " ");
  return String(v);
}

export default async function RecordsPage({
  searchParams,
}: {
  searchParams: Promise<{ model?: string; page?: string; b?: string }>;
}) {
  const sp = await searchParams;
  const view = (sp.model && sp.model in RECORD_VIEWS ? sp.model : "PolishEntry") as RecordView;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const batch = sp.b?.trim() || undefined;

  let result = null;
  let error: string | null = null;
  try {
    result = await listRecords(view, page, batch);
  } catch {
    error = "Could not read the database. Run the import first (see README).";
  }

  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;
  const qp = (p: number) =>
    `/records?model=${view}&page=${p}${batch ? `&b=${encodeURIComponent(batch)}` : ""}`;

  return (
    <Shell>
      <form method="GET" className="mb-5 flex flex-wrap items-center gap-2">
        <select
          name="model"
          defaultValue={view}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
        >
          {Object.entries(RECORD_VIEWS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
        <input
          name="b"
          defaultValue={batch ?? ""}
          placeholder="Filter by batch (optional)"
          className="w-56 rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        <button className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">
          Apply
        </button>
      </form>

      {error && <Empty>{error}</Empty>}

      {!error && result && (
        <Card>
          <div className="mb-3 text-sm text-gray-500">
            {result.total.toLocaleString()} records · page {page} of {totalPages}
          </div>
          {result.rows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500">
                    {result.columns.map((c) => (
                      <th key={c} className="whitespace-nowrap py-2 pr-4">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, i) => (
                    <tr key={i} className="border-t border-gray-100">
                      {result.columns.map((c) => (
                        <td key={c} className="whitespace-nowrap py-2 pr-4">
                          {cell(row[c])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>No records.</Empty>
          )}

          <div className="mt-4 flex items-center justify-between text-sm">
            <a
              href={qp(Math.max(1, page - 1))}
              className={`rounded-md border px-3 py-1.5 ${page <= 1 ? "pointer-events-none border-gray-100 text-gray-300" : "border-gray-300 text-gray-700 hover:bg-gray-50"}`}
            >
              ← Prev
            </a>
            <a
              href={qp(Math.min(totalPages, page + 1))}
              className={`rounded-md border px-3 py-1.5 ${page >= totalPages ? "pointer-events-none border-gray-100 text-gray-300" : "border-gray-300 text-gray-700 hover:bg-gray-50"}`}
            >
              Next →
            </a>
          </div>
        </Card>
      )}
    </Shell>
  );
}
