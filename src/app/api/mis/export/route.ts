// Excel export of the Breakdown & Deviation (downtime) log — the SAME data the /mis page
// shows, built from the SAME filters (from / to / b / type), so the download always matches
// the current on-screen view. One row per incident, plus the maintenance response.
//
// Audience = whoever can see the /mis page: every production-side role + Maintenance + Admin.
// Commercial and Sales are redirected away from /mis by middleware but can still reach /api,
// so they are excluded explicitly here.
import { getDowntimeReport, fmtDur, DELAY_FIELDS, DELAY_LABEL } from "@/lib/downtime";
import { getDowntimeResponses } from "@/lib/downtimeResponse";
import { photosForRecords } from "@/lib/entryPhoto";
import { currentRole } from "@/lib/rbac";
import * as XLSX from "xlsx";

export async function GET(request: Request) {
  const role = await currentRole();
  if (!role) return Response.json({ error: "Please sign in." }, { status: 401 });
  if (role === "COMMERCIAL" || role === "SALES") return Response.json({ error: "Not authorized" }, { status: 403 });

  try {
    const sp = new URL(request.url).searchParams;
    const from = sp.get("from")?.trim() || undefined;
    const to = sp.get("to")?.trim() || undefined;
    const batch = sp.get("b")?.trim() || undefined;
    const type = sp.get("type")?.trim() || undefined;

    const r = await getDowntimeReport({ from, to, batch, type });
    const resp = await getDowntimeResponses(r.incidents.map((i) => i.id));
    // null = the response lookup failed. Refuse rather than export a file whose
    // "Maint." columns read as "nobody responded" — that file outlives the glitch.
    if (resp === null) return Response.json({ error: "Could not load the maintenance responses — try the download again." }, { status: 503 });

    // Same per-type view the page shows: under a type filter, minutes/reasons are THAT
    // type's share (the row set is already filtered); in the All view a multi-type row
    // spells out each type's duration. The file must match the screen it came from.
    const photoMap = await photosForRecords("Mis", r.incidents.map((i) => i.id));
    const header = ["Date", "Hour", "Batch", "Down (min)", "Down", "Over 60m", "Type(s)", "Reason(s)", "Details", "RCA", "Action", "Spares", "Electrical incharge", "Mechanical incharge", "Maint. status", "Maint. note", "Responded by", "Responded at", "Maint. disputes", "Disputed by", "Photos"];
    const data: (string | number)[][] = [header];
    // incidents arrive unfiltered (the page filters client-side); apply the view's type here
    const incidents = r.typeFilter ? r.incidents.filter((i) => i.typeKeys.includes(r.typeFilter as string)) : r.incidents;
    for (const i of incidents) {
      const m = resp.get(i.id);
      const mins = r.typeFilter ? (i.minutesByType[r.typeFilter] ?? 0) : i.minutes;
      const types = r.typeFilter
        ? (DELAY_LABEL[r.typeFilter] ?? "")
        : Object.keys(i.minutesByType).length > 1
          ? DELAY_FIELDS.filter((d) => i.minutesByType[d.key]).map((d) => `${d.label} ${fmtDur(i.minutesByType[d.key])}`).join(" · ")
          : i.types.join(", ");
      const reasons = (r.typeFilter ? (i.reasonsByType[r.typeFilter] ?? []) : i.reasons).join(", ");
      data.push([
        i.date ?? "", i.hour ?? "", i.batch ?? "",
        mins || 0, mins > 0 ? fmtDur(mins) : "", i.over ? "YES" : "",
        types, reasons,
        i.details ?? "", i.rca ?? "", i.action ?? "", i.spares ?? "",
        i.elecIncharge ?? "", i.mechIncharge ?? "",
        m?.status ?? "", m?.note ?? "", m?.by ?? "", m?.at ?? "",
        // The dispute, phrased exactly as the page shows it: maintenance's figure beside
        // the logged one — or "agreed" once production's correction matches it.
        m?.dispMinutes != null
          ? (Math.round(i.minutesByType[m.dispType ?? ""] ?? 0) === Math.round(m.dispMinutes)
              ? `agreed — ${DELAY_LABEL[m.dispType ?? ""] ?? m.dispType ?? "?"} ${fmtDur(m.dispMinutes)}`
              : `${DELAY_LABEL[m.dispType ?? ""] ?? m.dispType ?? "?"} ${fmtDur(m.dispMinutes)} (logged ${fmtDur(i.minutesByType[m.dispType ?? ""] ?? 0)})`)
          : "",
        m?.dispMinutes != null ? (m?.dispBy ?? "") : "",
        (photoMap.get(i.id)?.length ?? 0) || "",
      ]);
    }

    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!cols"] = [{ wch: 11 }, { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 22 }, { wch: 30 }, { wch: 40 }, { wch: 8 }, { wch: 24 }, { wch: 16 }, { wch: 18 }, { wch: 18 }, { wch: 13 }, { wch: 30 }, { wch: 16 }, { wch: 16 }, { wch: 34 }, { wch: 16 }, { wch: 7 }];
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
