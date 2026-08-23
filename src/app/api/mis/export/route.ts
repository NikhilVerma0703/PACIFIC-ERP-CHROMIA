// Excel export of the Breakdown & Deviation (downtime) log — the SAME data the /mis page
// shows, built from the SAME filters (from / to / b / type), so the download always matches
// the current on-screen view. One row per incident, plus the maintenance response.
//
// Audience = whoever can see the /mis page: every production-side role + Maintenance + Admin.
// Every capped role and every branch block is handed ALL of /api by middleware, so the page's
// audience has to be restated here — maySeeMis (lib/routeCaps) is that single statement. It
// used to name only Commercial and Sales, which left the file open to operators, the store
// incharge and the fabrication and sales departments, none of whom can open the page it
// belongs to; the download button only renders on /mis.
import { getDowntimeReport, fmtDur, DELAY_FIELDS, DELAY_LABEL } from "@/lib/downtime";
import { getDowntimeResponses } from "@/lib/downtimeResponse";
import { photosForRecords } from "@/lib/entryPhoto";
import { currentUser } from "@/lib/rbac";
import { maySeeMis } from "@/lib/routeCaps";
import * as XLSX from "xlsx";

export async function GET(request: Request) {
  const me = await currentUser();
  const role = String((me as { role?: string | null } | null)?.role ?? "");
  if (!me || !role) return Response.json({ error: "Please sign in." }, { status: 401 });
  const branch = String((me as { branch?: string | null } | null)?.branch ?? "");
  if (!maySeeMis(role, branch)) return Response.json({ error: "Not authorized" }, { status: 403 });

  try {
    const sp = new URL(request.url).searchParams;
    const from = sp.get("from")?.trim() || undefined;
    const to = sp.get("to")?.trim() || undefined;
    const batch = sp.get("b")?.trim() || undefined;
    const type = sp.get("type")?.trim() || undefined;

    // allIncidents: the file must hold every row in the range. Without it the report caps
    // at 300 and the download silently disagreed with the KPI cards above it.
    const r = await getDowntimeReport({ from, to, batch, type, allIncidents: true });
    const resp = await getDowntimeResponses(r.incidents.map((i) => i.id));
    // null = the response lookup failed. Refuse rather than export a file whose
    // "Maint." columns read as "nobody responded" — that file outlives the glitch.
    if (resp === null) return Response.json({ error: "Could not load the maintenance responses — try the download again." }, { status: 503 });

    // The merged on-screen table shows the four delay buckets as columns, so the file
    // does too — one numeric minutes column per bucket, always all four, exactly like
    // the screen (a type chip narrows the ROWS, never the columns). "Down (min)" is
    // therefore always the hour's TOTAL, as on screen: the per-type share the old
    // single-figure export showed under a filter now has its own column. Reasons stay
    // per-type under a filter, and Type(s) keeps the flattened summary string — a
    // pivot-friendly label the bucket columns don't replace.
    const photoMap = await photosForRecords("Mis", r.incidents.map((i) => i.id));
    const header = ["Date", "Hour", "Batch", ...DELAY_FIELDS.map((d) => `${d.label} (min)`), "Down (min)", "Down", "Over 60m", "Type(s)", "Reason(s)", "Details", "RCA", "Action", "Spares", "Electrical incharge", "Mechanical incharge", "Maint. status", "Maint. note", "Responded by", "Responded at", "Photos"];
    const data: (string | number)[][] = [header];
    // incidents arrive unfiltered (the page filters client-side); apply the view's type here
    const incidents = r.typeFilter ? r.incidents.filter((i) => i.typeKeys.includes(r.typeFilter as string)) : r.incidents;
    for (const i of incidents) {
      const m = resp.get(i.id);
      const types = r.typeFilter
        ? (DELAY_LABEL[r.typeFilter] ?? "")
        : Object.keys(i.minutesByType).length > 1
          ? DELAY_FIELDS.filter((d) => i.minutesByType[d.key]).map((d) => `${d.label} ${fmtDur(i.minutesByType[d.key])}`).join(" · ")
          : i.types.join(", ");
      const reasons = (r.typeFilter ? (i.reasonsByType[r.typeFilter] ?? []) : i.reasons).join(", ");
      data.push([
        i.date ?? "", i.hour ?? "", i.batch ?? "",
        ...DELAY_FIELDS.map((d) => i.minutesByType[d.key] ?? 0),
        i.minutes || 0, i.minutes > 0 ? fmtDur(i.minutes) : "", i.over ? "YES" : "",
        types, reasons,
        i.details ?? "", i.rca ?? "", i.action ?? "", i.spares ?? "",
        i.elecIncharge ?? "", i.mechIncharge ?? "",
        m?.status ?? "", m?.note ?? "", m?.by ?? "", m?.at ?? "",
        (photoMap.get(i.id)?.length ?? 0) || "",
      ]);
    }

    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!cols"] = [{ wch: 11 }, { wch: 8 }, { wch: 10 }, { wch: 14 }, { wch: 10 }, { wch: 20 }, { wch: 12 }, { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 22 }, { wch: 30 }, { wch: 40 }, { wch: 8 }, { wch: 24 }, { wch: 16 }, { wch: 18 }, { wch: 18 }, { wch: 13 }, { wch: 30 }, { wch: 16 }, { wch: 16 }, { wch: 7 }];
    ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: data.length - 1, c: header.length - 1 } }) };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Downtime log");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

    // filename carries the range so several exports don't collide. Use the NORMALIZED batch
    // and strip anything unsafe — the batch box is free text, and a stray quote/newline would
    // otherwise truncate the name or make the Headers constructor throw (500 instead of a file).
    const safe = (s: string) => s.replace(/[^\w.-]/g, "");
    const tag = r.batch ? `batch-${safe(r.batch) || "x"}` : `${safe(r.from)}_to_${safe(r.to)}`;
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="downtime-log-${tag}.xlsx"`,
      },
    });
  } catch (e) {
    console.error("Downtime export error:", e);
    return Response.json({ error: "Export failed" }, { status: 500 });
  }
}
