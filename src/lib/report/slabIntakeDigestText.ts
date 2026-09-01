// The slab-intake digest, minus the database: the window arithmetic and the
// words. Import-free on purpose, the same reason lib/inventory/approvalKey.ts
// and lib/shiftScoreMath.ts are split out — `node --test` resolves neither the
// "@/" alias nor prisma, and the boundaries of this report are exactly the part
// that must be tested. slabIntakeDigest.ts re-exports all of it, so no caller
// needs to know there are two files.
//
// What the slab-intake form recorded, once a shift, to the person who owns it.
//
// TWO WINDOWS A DAY, and they are the plant's halves, not the clock's:
//   06:00 -> 18:00 IST, sent at 18:01
//   18:00 -> 06:00 IST, sent at 06:01 the next morning
// Together they tile the production day the rest of the ERP runs on, so nothing
// falls between two digests and nothing is reported twice.
//
// WHAT COUNTS AS "ENTERED". Every action the form takes writes a SlabEvent with
// source "Slab intake form" — a slab added, a field corrected, a defect photo
// attached, a design/batch approved for Sales. The digest reports all of them,
// grouped by slab, because a corrected grade is as much a thing somebody
// entered as a new row is. The heading counts the two apart so the reader can
// tell at a glance whether the shift added stock or fixed records.
//
// The window arithmetic is pure and lives here so it can be tested without a
// database — the report is only ever as right as its boundaries.

/** The source string the intake form stamps on everything it writes. */
export const INTAKE_SOURCE = "Slab intake form";
const IST_MIN = 330;

export type WindowKind = "day" | "night";

export interface DigestWindow {
  kind: WindowKind;
  /** Inclusive start, as a real instant. */
  from: Date;
  /** Exclusive end. */
  to: Date;
  /** "the day shift of 2 September" — how the email names itself. */
  label: string;
}

const istParts = (ms: number) => {
  const d = new Date(ms + IST_MIN * 60_000);
  return { day: d.toISOString().slice(0, 10), hour: d.getUTCHours() };
};
/** An IST wall-clock moment as a real instant. */
const istAt = (day: string, hour: number) =>
  new Date(Date.parse(`${day}T00:00:00.000Z`) + (hour * 60 - IST_MIN) * 60_000);
const shiftDay = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00.000Z`) + n * 86_400_000).toISOString().slice(0, 10);

const MONTHS = ["January", "February", "March", "April", "May", "June",
                "July", "August", "September", "October", "November", "December"];
const longDay = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return y && m && d ? `${d} ${MONTHS[m - 1]} ${y}` : iso;
};

/**
 * Which half of the day a run at `nowMs` is reporting on.
 *
 * DECIDED BY THE CLOCK, NOT BY THE SCHEDULE, so a late or re-run job still
 * reports the window it was meant to and a hand-run at any hour is predictable.
 * Noon splits them: a run in the afternoon or evening closes the day shift that
 * is ending; a run in the small hours or the early morning closes the night
 * that is ending. `kind` can be forced for a test send.
 */
export function digestWindow(nowMs: number, force?: WindowKind): DigestWindow {
  const { day, hour } = istParts(nowMs);
  const kind: WindowKind = force ?? (hour >= 12 ? "day" : "night");
  if (kind === "day") {
    // 06:00 -> 18:00 of the day now ending.
    return { kind, from: istAt(day, 6), to: istAt(day, 18), label: `the day shift of ${longDay(day)}` };
  }
  // 18:00 yesterday -> 06:00 today. Before 18:00 the night that ended this
  // morning is the one being closed; at or after 18:00 (a late re-run) it is
  // still that same night, never the one now starting.
  const ended = hour < 18 ? day : day;
  return {
    kind,
    from: istAt(shiftDay(ended, -1), 18),
    to: istAt(ended, 6),
    label: `the night shift of ${longDay(shiftDay(ended, -1))} into ${longDay(ended)}`,
  };
}

export interface DigestSlab {
  slabNumber: number;
  /** True when this window is where the slab first entered finished goods. */
  added: boolean;
  design: string | null;
  grade: string | null;
  batch: string | null;
  status: string | null;
  bay: string | null;
  photos: number;
  /** "grade A → B", one per corrected field, in the order they were written. */
  changes: string[];
  by: string[];
  at: Date;
}

export interface Digest {
  window: DigestWindow;
  slabs: DigestSlab[];
  addedCount: number;
  correctedCount: number;
  photoCount: number;
  people: string[];
}

const esc = (v: unknown) =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The one-line summary the subject and the first paragraph both use. */
export function digestHeadline(d: Digest): string {
  if (!d.slabs.length) return "nothing was entered";
  const bits: string[] = [];
  if (d.addedCount) bits.push(`${d.addedCount} slab${d.addedCount === 1 ? "" : "s"} added`);
  if (d.correctedCount) bits.push(`${d.correctedCount} corrected`);
  if (d.photoCount) bits.push(`${d.photoCount} photo${d.photoCount === 1 ? "" : "s"}`);
  return bits.join(", ");
}

/** Subject line: says what happened, so the inbox is readable unopened. */
export function digestSubject(d: Digest): string {
  const half = d.window.kind === "day" ? "day shift" : "night shift";
  return `Slab intake — ${half} — ${digestHeadline(d)}`;
}

export function digestBody(d: Digest, url: string): { text: string; html: string } {
  const when = `${d.window.label} (${d.window.kind === "day" ? "06:00 to 18:00" : "18:00 to 06:00"})`;
  if (!d.slabs.length) {
    const line = `Nothing was entered on the slab-intake form during ${when}.`;
    return {
      text: [line, "", "— Pacific ERP"].join("\n"),
      html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#202124;line-height:1.5">`
        + `<p>${esc(line)}</p><p style="color:#5f6368">— Pacific ERP</p></div>`,
    };
  }

  const head = `${digestHeadline(d)} on the slab-intake form during ${when}.`;
  const who = d.people.length ? ` Entered by ${d.people.join(", ")}.` : "";

  const lines = d.slabs.map((s) => {
    const what = s.added ? "added" : s.changes.length ? "corrected" : "photo only";
    const detail = [
      [s.design, s.grade, s.batch ? `batch ${s.batch}` : null, s.bay].filter(Boolean).join(" · "),
      s.changes.length ? s.changes.join("; ") : null,
      s.photos ? `${s.photos} photo${s.photos === 1 ? "" : "s"}` : null,
    ].filter(Boolean).join(" — ");
    return `  ${s.slabNumber}  ${what.padEnd(10)} ${detail}`;
  });

  const text = [head + who, "", ...lines, "", `Open the sheet: ${url}`, "", "— Pacific ERP"].join("\n");

  const rows = d.slabs.map((s) => `<tr>
      <td style="padding:6px 10px;border-bottom:1px solid #eceff1"><b>${esc(s.slabNumber)}</b></td>
      <td style="padding:6px 10px;border-bottom:1px solid #eceff1">${esc(s.added ? "added" : s.changes.length ? "corrected" : "photo only")}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eceff1">${esc([s.design, s.grade, s.batch ? `batch ${s.batch}` : null, s.bay].filter(Boolean).join(" · "))}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eceff1;color:#5f6368">${esc(s.changes.join("; "))}${s.photos ? esc((s.changes.length ? " · " : "") + s.photos + " photo" + (s.photos === 1 ? "" : "s")) : ""}</td>
    </tr>`).join("");

  const html = [
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#202124;line-height:1.5">`,
    `<p>${esc(head)}${esc(who)}</p>`,
    `<table style="border-collapse:collapse;font-size:13px">`,
    `<tr style="text-align:left;color:#5f6368">`,
    `<th style="padding:6px 10px;border-bottom:1px solid #cfd8dc">Slab</th>`,
    `<th style="padding:6px 10px;border-bottom:1px solid #cfd8dc">What</th>`,
    `<th style="padding:6px 10px;border-bottom:1px solid #cfd8dc">Now reads</th>`,
    `<th style="padding:6px 10px;border-bottom:1px solid #cfd8dc">Changes</th></tr>`,
    rows,
    `</table>`,
    `<p><a href="${esc(url)}">Open the slab-intake sheet</a></p>`,
    `<p style="color:#5f6368">— Pacific ERP</p>`,
    `</div>`,
  ].join("");

  return { text, html };
}
