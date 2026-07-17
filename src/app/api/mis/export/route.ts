// Excel export of the Breakdown & Deviation (downtime) log — the SAME data the /mis page
// shows, built from the SAME filters (from / to / b / type), so the download always matches
// the current on-screen view. One row per incident, plus the maintenance response.
//
// Audience = whoever can see the /mis page: every production-side role + Maintenance + Admin.
// Commercial and Sales are redirected away from /mis by middleware but can still reach /api,
// so they are excluded explicitly here.
import { getDowntimeReport, fmtDur } from "@/lib/downtime";
import { getDowntimeResponses } from "@/lib/downtimeResponse";
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

    const header = ["Date", "Hour", "Batch", "Down (min)", "Down", "Over 60m", "Type(s)", "Reason(s)", "Details", "RCA", "Action", "Spares", "Electrical incharge", "Mechanical incharge", "Maint. status", "Maint. note", "Responded by", "Responded at"];
    const data: (string | number)[][] = [header];
    for (const i of r.incidents) {
      const m = resp.get(i.id);
      data.push([
        i.date ?? "", i.hour ?? "", i.batch ?? "",
        i.minutes || 0, i.minutes > 0 ? fmtDur(i.minutes) : "", i.over ? "YES" : "",
        i.types.join(", "), i.reasons.join(", "),
        i.details ?? "", i.rca ?? "", i.action ?? "", i.spares ?? "",
        i.elecIncharge ?? "", i.mechIncharge ?? "",
        m?.status ?? "", m?.note ?? "", m?.by ?? "", m?.at ?? "",
      ]);
    }

    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!cols"] = [{ wch: 11 }, { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 22 }, { wch: 30 }, { wch: 40 }, { wch: 8 }, { wch: 24 }, { wch: 16 }, { wch: 18 }, { wch: 18 }, { wch: 13 }, { wch: 30 }, { wch: 16 }, { wch: 16 }];
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
