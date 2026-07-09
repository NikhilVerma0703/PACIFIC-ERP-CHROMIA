// Builds the Telegram report texts (hourly / shift-end / daily) from the same
// libraries the Downtime page uses. All times are IST.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { getShiftReport } from "@/lib/misShift";
import { shiftOfHour, SHIFT_WINDOW } from "@/lib/misShiftHours";
import { getDowntimeReport, fmtDur } from "@/lib/downtime";
import { esc } from "@/lib/telegram";

const db = prisma as any;
const IST = 330 * 60000;
export const ymdIST = (ms = Date.now()) => new Date(ms + IST).toISOString().slice(0, 10);
export const plusDay = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const n0 = (v: unknown) => Number(v ?? 0) || 0;

const DELAYS = [
  ["processDelayDurationMinutes", "Operational"],
  ["cleaningDelayDurationMinutes", "Cleaning"],
  ["breakdownDelayDurationMechanicalOrElectricalMinutes", "Mech/Elec"],
  ["poweroutDelayDurationMinutes", "Power out"],
] as const;

/** The most recently COMPLETED IST hour as a "HH - HH" bucket + its calendar date. */
export function lastCompletedHourIST(): { bucket: string; date: string } {
  const ist = new Date(Date.now() + IST);
  const end = ist.getUTCHours();                 // bucket that just ended at HH:00
  const start = (end + 23) % 24;
  const bucket = `${String(start).padStart(2, "0")} - ${String(end).padStart(2, "0")}`;
  // the bucket belongs to the day it STARTED (23 - 00 belongs to yesterday)
  const date = start === 23 ? plusDay(ymdIST(), -1) : ymdIST();
  return { bucket, date };
}

/** Hourly message: the hour's MIS entry (or a missed-entry alert) + downtime callout. */
export async function hourlyMessage(bucket: string, date: string): Promise<string> {
  const d0 = new Date(`${date}T00:00:00.000Z`);
  const d1 = new Date(`${plusDay(date, 1)}T00:00:00.000Z`);
  let rows: any[] = [];
  try {
    rows = await db.mis.findMany({
      where: { hour: bucket, OR: [
        { date: { gte: d0, lt: d1 } },
        { AND: [{ date: null }, { dateAndTime: { gte: d0, lt: d1 } }] },
      ] },
      select: { batch: true, design: true, slabsPerHourStd: true, slabsPerHourActual: true,
        startingSlabNumber: true, endingSlabNumber: true, numberOfJumpedSlabs: true,
        areaOfProblem: true, reasonForDeviation: true, details: true, submittedBy: true,
        productionInchargeName: true, anyBreakdownYesNo: true,
        processDelayDurationMinutes: true, cleaningDelayDurationMinutes: true,
        breakdownDelayDurationMechanicalOrElectricalMinutes: true, poweroutDelayDurationMinutes: true },
      orderBy: { importedAt: "desc" }, // newest wins if a legacy duplicate exists
    });
  } catch { /* report as missing rather than crash the cron */ }
  const shift = shiftOfHour(bucket);
  if (rows.length === 0)
    return `⚠️ <b>MIS not logged</b> — hour <b>${bucket}</b> (${date}, Shift ${shift}) has no entry yet. Please fill it on the MIS sheet.`;

  const r = rows[0];
  const delayParts = DELAYS.map(([k, l]) => (n0(r[k]) > 0 ? `${l} ${Math.round(n0(r[k]))}m` : null)).filter(Boolean);
  const delayTotal = DELAYS.reduce((a, [k]) => a + n0(r[k]), 0);
  const lines = [
    `🏭 <b>MIS ${bucket}</b> · ${date} · Shift ${shift}`,
    `Batch <b>${esc(r.batch ?? "—")}</b>${r.design ? ` · ${esc(r.design)}` : ""}`,
    `Slabs: <b>${r.slabsPerHourActual ?? "—"}</b> actual${r.slabsPerHourStd != null ? ` (std ${r.slabsPerHourStd})` : ""}` +
      (r.startingSlabNumber != null && r.endingSlabNumber != null ? ` · #${r.startingSlabNumber}–${r.endingSlabNumber}${n0(r.numberOfJumpedSlabs) > 0 ? ` (${n0(r.numberOfJumpedSlabs)} jumped)` : ""}` : ""),
  ];
  if (delayTotal > 0) {
    lines.push(`⏱ DOWNTIME <b>${Math.round(delayTotal)} min</b> — ${delayParts.join(", ")}`);
    if ((r.areaOfProblem ?? []).length) lines.push(`Area: ${esc(r.areaOfProblem.join(", "))}`);
    if ((r.reasonForDeviation ?? []).length) lines.push(`Reason: ${esc(r.reasonForDeviation.join(", "))}`);
    if (r.details) lines.push(`“${esc(r.details)}”`);
  }
  if (String(r.anyBreakdownYesNo ?? "").toLowerCase() === "yes") lines.push("🛠 Breakdown reported");
  lines.push(`By: ${esc(r.productionInchargeName ?? r.submittedBy ?? "—")}`);
  return lines.join("\n");
}

/** Shift-end report (like the Downtime page's Last Shift card). */
export async function shiftMessage(anchor: string, shift: "A" | "B" | "C"): Promise<string> {
  const r = await getShiftReport(anchor, shift).catch(() => null);
  if (!r) return `📋 <b>Shift ${shift} report</b> · ${anchor} · ${SHIFT_WINDOW[shift]}\n⚠️ No MIS entries were logged this shift.`;
  const lines = [
    `📋 <b>Shift ${shift} report</b> · ${r.date} · ${r.window}`,
    `Slabs pressed: <b>${r.slabs}</b> · hours logged ${r.hoursLogged}/${r.hoursTotal}`,
    `Downtime: <b>${r.delayMin > 0 ? fmtDur(r.delayMin) : "none"}</b>`,
  ];
  if (r.batches.length || r.designs.length) lines.push(`Batch/design: ${esc([...r.batches, ...r.designs].slice(0, 6).join(", "))}`);
  if (r.areas.length) lines.push(`Problem areas: ${esc(r.areas.join(", "))}`);
  lines.push(`Incharge: ${esc(r.prodIncharge ?? (r.submitters.join(", ") || "—"))}${r.maintIncharge ? ` · Maint: ${esc(r.maintIncharge)}` : ""}`);
  if (r.hoursLogged < r.hoursTotal) lines.push(`⚠️ ${r.hoursTotal - r.hoursLogged} hour(s) missing from the log`);
  return lines.join("\n");
}

/** Daily report for one IST calendar day (defaults: yesterday). */
export async function dailyMessage(day: string): Promise<string> {
  const r = await getDowntimeReport({ from: day, to: day }).catch(() => null);
  if (!r) return `📅 <b>Daily report ${day}</b>\n⚠️ Could not read the MIS log.`;
  const types = r.byType.filter((t) => t.minutes > 0).map((t) => `${t.label} ${fmtDur(t.minutes)}`).join(" · ");
  const designs = r.designs.slice(0, 5).map((d) => `${esc(d.design)} ${d.slabs}`).join(", ");
  const lines = [
    `📅 <b>Daily report ${day}</b>`,
    `Slabs made: <b>${r.actualSlabs}</b> · achievable ${r.achievable} · target ${r.target}${r.lost > 0 ? ` · lost ~${r.lost}` : ""}`,
    `Downtime: <b>${r.totalMinutes > 0 ? fmtDur(r.totalMinutes) : "none"}</b>${types ? ` (${types})` : ""}`,
  ];
  if (designs) lines.push(`Designs: ${designs}${r.designs.length > 5 ? ` +${r.designs.length - 5} more` : ""}`);
  if (r.unloggedBatches > 0) lines.push(`⚠️ ${r.unloggedBatches} pressed batch(es) missing MIS entries`);
  const topReason = r.byReason[0];
  if (topReason) lines.push(`Top reason: ${esc(topReason.reason)} (${fmtDur(topReason.minutes)})`);
  return lines.join("\n");
}

/** Jot defect alert: fires when a Jot entry is saved with a slab defect.
 * Sends the entry's photo when one was attached; text-only otherwise.
 * Strictly best-effort — never throws into the save path. */
export async function jotDefectAlert(recordId: string, d: Record<string, unknown>): Promise<void> {
  try {
    const { sendTelegramPhoto } = await import("@/lib/telegram");
    const when = new Date(Date.now() + IST).toISOString().slice(11, 16);
    const caption = [
      `🚨 <b>Defect at JOT — ${esc(d.slabDefect)}</b>`,
      `Slab <b>${esc(d.slabNumber ?? "—")}</b> · Batch ${esc(d.batch ?? "—")}${d.designName ? ` · ${esc(d.designName)}` : ""}`,
      `${d.remarks ? `“${esc(d.remarks)}” · ` : ""}by ${esc(d.operator ?? "—")} · ${when} IST`,
    ].join("\n");
    const photo: any[] = await db.$queryRaw`
      SELECT data, mime, filename FROM entry_photo
      WHERE model = 'Jot' AND record_id = ${recordId}
      ORDER BY at DESC LIMIT 1`.catch(() => []);
    if (photo.length && photo[0].data) {
      await sendTelegramPhoto(caption, photo[0].data, photo[0].filename ?? "defect.jpg", photo[0].mime ?? "image/jpeg");
    } else {
      const { sendTelegram } = await import("@/lib/telegram");
      await sendTelegram(caption + "\n(no photo attached)");
    }
  } catch (e) {
    console.error("Jot defect alert error:", e);
  }
}
