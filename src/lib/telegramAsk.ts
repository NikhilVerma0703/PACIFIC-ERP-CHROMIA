// Free-text questions from the Telegram group ("/ask how many slabs did we
// lose to downtime this week?"). We do NOT let the model touch the DB — we
// hand it a compact pack of live production numbers and it answers from that.
// Needs ANTHROPIC_API_KEY in env; soft-fails with a friendly message without it.
import { prisma } from "@/lib/prisma";
import { getDowntimeReport } from "@/lib/downtime";
import { getLastShiftReport, getShiftReport, currentShiftAnchor } from "@/lib/misShift";
import { ymdIST, plusDay, lastCompletedHourIST, hourlyMessage } from "@/lib/telegramReports";
import { esc } from "@/lib/telegram";
import { thicknessBySlab, thicknessMixByBatch, mergeMix, mixLabel } from "@/lib/slabThickness";

async function dataPack(question = ""): Promise<string> {
  const today = ymdIST();
  const wk = plusDay(today, -6);
  const { bucket, date } = lastCompletedHourIST();
  const [d7, dToday, shift, hourMsg] = await Promise.all([
    getDowntimeReport({ from: wk, to: today }).catch(() => null),
    getDowntimeReport({ from: today, to: today }).catch(() => null),
    getLastShiftReport().catch(() => null),
    hourlyMessage(bucket, date).catch(() => ""),
  ]);
  const lines: string[] = [`TODAY=${today} · last completed hour ${bucket}`];
  if (hourMsg) lines.push(`CURRENT HOUR: ${hourMsg.replace(/<[^>]+>/g, "")}`);
  if (shift) lines.push(`LAST SHIFT ${shift.shift} (${shift.date} ${shift.window}): slabs=${shift.slabs}, hoursLogged=${shift.hoursLogged}/${shift.hoursTotal}, downtimeMin=${shift.delayMin}, incharge=${shift.prodIncharge ?? shift.submitters.join("/")}, batches=${shift.batches.join("/")}`);
  for (const [label, r] of [["TODAY", dToday], ["LAST 7 DAYS", d7]] as const) {
    if (!r) continue;
    lines.push(`${label}: slabsMade=${r.actualSlabs}, achievable=${r.achievable}, target=${r.target}, lostToDowntime=${r.lost}, downtimeMin=${r.totalMinutes}, byType=${r.byType.map((t) => `${t.label}:${t.minutes}m`).join(",")}, topReasons=${r.byReason.slice(0, 5).map((x) => `${x.reason}:${x.minutes}m`).join(",")}, designs=${r.designs.slice(0, 6).map((d) => `${d.design}:${d.slabs}`).join(",")}, unloggedBatches=${r.unloggedBatches}`);
  }
  // GLOBAL data (not just MIS): press machine truth per batch + finished goods
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const db = prisma as any;
    const batches: any[] = await db.$queryRaw`
      SELECT batch, count(DISTINCT slab_number)::int slabs, min(slab_number)::int lo, max(slab_number)::int hi, max(imported_at) last
      FROM press
      WHERE imported_at > now() - interval '10 days' AND batch IS NOT NULL
      GROUP BY batch ORDER BY max(imported_at) DESC LIMIT 8`;
    if (batches.length) lines.push("PRESS MACHINE TOTALS BY BATCH (last 10 days — the authoritative slab counts): "
      + batches.map((b) => `${b.batch}: ${b.slabs} slabs (#${b.lo}-#${b.hi})`).join("; "));
    // MIS logged sums per batch — so discrepancies vs press are visible
    const misSums: any[] = await db.$queryRaw`
      SELECT batch, sum(slabs_per_hour_actual)::float logged,
             count(*) FILTER (WHERE slabs_per_hour_actual IS NULL)::int hours_without_count
      FROM mis WHERE imported_at > now() - interval '10 days' AND batch IS NOT NULL
      GROUP BY batch ORDER BY max(imported_at) DESC LIMIT 8`;
    if (misSums.length) lines.push("MIS MANUAL LOG BY BATCH (same period — compare with press to spot gaps): "
      + misSums.map((m) => `${m.batch}: logged ${m.logged ?? 0}${m.hours_without_count ? ` (+${m.hours_without_count} hrs missing counts)` : ""}`).join("; "));
    // SLAB THICKNESS per batch (2 cm vs 3 cm). Thickness is NOT recorded at the press
    // or the oven — it is stamped at Distributor/Kreos, the polish stations and Jot,
    // so it is resolved per slab across all of them.
    const tkeys: any[] = await db.$queryRaw`
      SELECT batch_key k FROM press
      WHERE imported_at > now() - interval '10 days' AND batch_key IS NOT NULL
      GROUP BY 1 ORDER BY max(imported_at) DESC LIMIT 8`;
    const mixByBatch = await thicknessMixByBatch(tkeys.map((r: any) => String(r.k)));
    if (mixByBatch.size) lines.push("SLAB THICKNESS BY BATCH (which slabs are 2 cm vs 3 cm — batches pressed in the last 10 days; each split is counted over that batch's FULL press slab list, so it adds up to the batch's press total): "
      + tkeys.map((r: any) => `${r.k}: ${mixLabel(mixByBatch.get(String(r.k)))}`).join("; "));
    const fg: any[] = await db.$queryRaw`SELECT count(*)::int n FROM fg_finished_slab WHERE status = 'AVAILABLE'`;
    lines.push(`FINISHED GOODS: ${fg[0]?.n ?? "?"} slabs currently AVAILABLE in stock`);
    // Polish QC grade split (the "ABC report") per batch, last 10 days
    const qc: any[] = await db.$queryRaw`
      SELECT batch_key, quality_grade, count(*)::int n
      FROM polish_qc
      WHERE imported_at > now() - interval '10 days' AND batch_key IS NOT NULL
      GROUP BY 1, 2 ORDER BY max(imported_at) DESC`;
    // JOT station: defects + inspection volume per batch (last 10 days)
    const jot: any[] = await db.$queryRaw`
      SELECT batch, slab_defect, count(*)::int n
      FROM jot WHERE imported_at > now() - interval '10 days' AND batch IS NOT NULL
      GROUP BY 1, 2 ORDER BY max(imported_at) DESC LIMIT 24`;
    if (jot.length) {
      const byB = new Map<string, { total: number; defects: string[] }>();
      for (const r of jot) {
        const e = byB.get(String(r.batch)) ?? { total: 0, defects: [] };
        e.total += r.n;
        if (r.slab_defect) e.defects.push(`${r.slab_defect}:${r.n}`);
        byB.set(String(r.batch), e);
      }
      lines.push("JOT STATION BY BATCH (last 10 days — slabs inspected + defects found): "
        + [...byB.entries()].slice(0, 8).map(([b, e]) => `${b}: ${e.total} slabs${e.defects.length ? ` (defects ${e.defects.join(" ")})` : " (no defects)"}`).join("; "));
    }
    if (qc.length) {
      const byBatch = new Map<string, string[]>();
      for (const r of qc) {
        const k = String(r.batch_key);
        byBatch.set(k, [...(byBatch.get(k) ?? []), `${r.quality_grade ?? "ungraded"}:${r.n}`]);
      }
      lines.push("POLISH QC GRADES BY BATCH (last 10 days — the ABC quality report): "
        + [...byBatch.entries()].slice(0, 10).map(([b, gs]) => `${b}: ${gs.join(" ")}`).join("; "));
    }
  } catch { /* pack still useful without the global block */ }
  // LAST-HOUR ACTIVITY per station: slab-level, so "what was entered in the
  // last hour at Polish QC / press / JOT" answers with the actual entries.
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const db = prisma as any;
    const [qcAct, prAct, jtAct]: any[][] = await Promise.all([
      db.$queryRaw`SELECT slab_number, quality_grade, batch_number, design FROM polish_qc WHERE imported_at > now() - interval '75 minutes' ORDER BY imported_at DESC LIMIT 40`,
      db.$queryRaw`SELECT slab_number, batch FROM press WHERE imported_at > now() - interval '75 minutes' ORDER BY imported_at DESC LIMIT 40`,
      db.$queryRaw`SELECT slab_number, slab_defect, batch FROM jot WHERE imported_at > now() - interval '75 minutes' ORDER BY imported_at DESC LIMIT 40`,
    ]);
    lines.push(`POLISH QC ENTRIES LAST ~75min (${qcAct.length}${qcAct.length === 40 ? "+" : ""}): ` + (qcAct.length
      ? qcAct.map((r: any) => `${r.slab_number}(${r.quality_grade ?? "ungraded"})`).join(" ") + ` — batches ${[...new Set(qcAct.map((r: any) => r.batch_number).filter(Boolean))].join(",")} designs ${[...new Set(qcAct.map((r: any) => r.design).filter(Boolean))].join(",") || "?"}`
      : "none"));
    lines.push(`PRESS ENTRIES LAST ~75min (${prAct.length}${prAct.length === 40 ? "+" : ""}): ` + (prAct.length
      ? prAct.map((r: any) => r.slab_number).join(" ") + ` — batch ${[...new Set(prAct.map((r: any) => r.batch).filter(Boolean))].join(",")}`
      : "none"));
    lines.push(`JOT ENTRIES LAST ~75min (${jtAct.length}${jtAct.length === 40 ? "+" : ""}): ` + (jtAct.length
      ? jtAct.map((r: any) => `${r.slab_number}${r.slab_defect ? `(${r.slab_defect})` : ""}`).join(" ")
      : "none"));
  } catch { /* best-effort */ }
  // HOUR-BY-HOUR station breakdown for today + yesterday — answers any
  // time-window question ("what was polished 8-9am", "press output yesterday
  // afternoon") with counts and slab ranges per IST hour.
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const db = prisma as any;
    const days = [ymdIST(), plusDay(ymdIST(), -1)];
    const stations: [string, string][] = [["press", "PRESS"], ["polish_qc", "POLISH QC"], ["jot", "JOT"]];
    for (const [table, label] of stations) {
      for (const day of days) {
        const d0 = new Date(Date.parse(`${day}T00:00:00+05:30`));
        const d1 = new Date(d0.getTime() + 86400000);
        const rows: any[] = await db.$queryRawUnsafe(
          `SELECT to_char(imported_at + interval '330 minutes', 'HH24') h,
                  count(*)::int n, min(slab_number)::int lo, max(slab_number)::int hi
           FROM ${table} WHERE imported_at >= $1 AND imported_at < $2 GROUP BY 1 ORDER BY 1`,
          d0, d1,
        ).catch(() => []);
        if (rows.length) lines.push(`${label} BY HOUR (${day === days[0] ? "today" : "yesterday"} ${day}, IST): `
          + rows.map((r) => `${r.h}:00→${r.n}${r.lo ? `(#${r.lo}-#${r.hi})` : ""}`).join(" "));
      }
    }
  } catch { /* best-effort */ }
  // LATEST ENTRY per station (all-time) + silo stock + FG by status — the
  // broad live picture, so "last slab polished / what's in silo 201" answers.
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const db = prisma as any;
    const ago = (d: any) => `${Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 60000))}min ago`;
    const one = (sql: Promise<any[]>) => sql.then((r) => r[0] ?? null).catch(() => null);
    const [lqc, lpr, ljt, lov, lmx, ldi, lkr, silos, fgs]: any[] = await Promise.all([
      one(db.$queryRaw`SELECT slab_number, quality_grade, batch_number, design, imported_at FROM polish_qc ORDER BY imported_at DESC LIMIT 1`),
      one(db.$queryRaw`SELECT slab_number, batch, imported_at FROM press ORDER BY imported_at DESC LIMIT 1`),
      one(db.$queryRaw`SELECT slab_number, batch, slab_defect, imported_at FROM jot ORDER BY imported_at DESC LIMIT 1`),
      one(db.$queryRaw`SELECT slab_number, batch, imported_at FROM oven ORDER BY imported_at DESC LIMIT 1`),
      one(db.$queryRaw`SELECT batch, imported_at FROM mixer_cycle ORDER BY imported_at DESC LIMIT 1`),
      one(db.$queryRaw`SELECT batch, slab_number, imported_at FROM distributor ORDER BY imported_at DESC LIMIT 1`),
      one(db.$queryRaw`SELECT batch, slab_number, imported_at FROM kreos ORDER BY imported_at DESC LIMIT 1`),
      db.$queryRaw`SELECT silo_no, round(sum(remaining_weight)::numeric)::float kg FROM silo WHERE remaining_weight > 0 AND silo_no IS NOT NULL GROUP BY 1 ORDER BY 1 LIMIT 16`.catch(() => []),
      db.$queryRaw`SELECT status, count(*)::int n FROM fg_finished_slab GROUP BY 1`.catch(() => []),
    ]);
    const L: string[] = [];
    if (lpr) L.push(`press slab ${lpr.slab_number} (${lpr.batch ?? "?"}, ${ago(lpr.imported_at)})`);
    if (ljt) L.push(`JOT slab ${ljt.slab_number}${ljt.slab_defect ? ` DEFECT ${ljt.slab_defect}` : ""} (${ljt.batch ?? "?"}, ${ago(ljt.imported_at)})`);
    if (lqc) L.push(`polishQC slab ${lqc.slab_number} design ${lqc.design ?? "?"} grade ${lqc.quality_grade ?? "ungraded"} (${lqc.batch_number ?? "?"}, ${ago(lqc.imported_at)})`);
    if (lov) L.push(`oven slab ${lov.slab_number} (${lov.batch ?? "?"}, ${ago(lov.imported_at)})`);
    if (lmx) L.push(`mixer ${lmx.batch ?? "?"} (${ago(lmx.imported_at)})`);
    if (ldi) L.push(`distributor ${ldi.batch ?? "?"} slab ${ldi.slab_number ?? "?"} (${ago(ldi.imported_at)})`);
    if (lkr) L.push(`kreos ${lkr.batch ?? "?"} slab ${lkr.slab_number ?? "?"} (${ago(lkr.imported_at)})`);
    if (L.length) lines.push("LATEST ENTRY PER STATION: " + L.join("; "));
    if (silos.length) lines.push("SILO STOCK (kg remaining): " + silos.map((r: any) => `${r.silo_no}:${r.kg}`).join(" "));
    if (fgs.length) lines.push("FINISHED GOODS BY STATUS: " + fgs.map((r: any) => `${r.status}:${r.n}`).join(" "));
  } catch { /* best-effort */ }
  // QUESTION-AWARE: any batch number mentioned gets full targeted stats —
  // never again "no data" because a list cap cut the asked batch out.
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const db = prisma as any;
    const keys = [...new Set((question.match(/\b[A-Za-z]{0,2}(\d{3,4})\b/g) ?? []).map((t) => t.replace(/\D/g, "")))].slice(0, 3);
    for (const k of keys) {
      const like = `%${k}%`;
      const [pr, mi, qc, jt, bk]: any[][] = await Promise.all([
        db.$queryRaw`SELECT count(DISTINCT slab_number)::int n, min(slab_number)::int lo, max(slab_number)::int hi FROM press WHERE batch ILIKE ${like}`,
        db.$queryRaw`SELECT sum(slabs_per_hour_actual)::float s, count(*) FILTER (WHERE slabs_per_hour_actual IS NULL)::int miss FROM mis WHERE batch ILIKE ${like}`,
        db.$queryRaw`SELECT quality_grade g, count(*)::int n FROM polish_qc WHERE batch_key = ${k} OR batch_number ILIKE ${like} GROUP BY 1`,
        db.$queryRaw`SELECT slab_defect d, count(*)::int n FROM jot WHERE batch ILIKE ${like} GROUP BY 1`,
        db.$queryRaw`SELECT DISTINCT batch_key k FROM press WHERE batch ILIKE ${like} AND batch_key IS NOT NULL`,
      ]);
      if (!(pr[0]?.n || mi[0]?.s || qc.length || jt.length)) continue;
      // thickness for the asked batch (and any design-switch sub-batch of it)
      const merged = mergeMix((await thicknessMixByBatch(bk.map((r: any) => String(r.k)))).values());
      lines.push(`ASKED BATCH ${k} (all-time detail): press ${pr[0]?.n ?? 0} slabs${pr[0]?.lo ? ` (#${pr[0].lo}-#${pr[0].hi})` : ""}; thickness ${mixLabel(merged)}; MIS logged ${mi[0]?.s ?? 0}${mi[0]?.miss ? ` (${mi[0].miss} hrs without counts)` : ""}; QC ${qc.length ? qc.map((r: any) => `${r.g ?? "ungraded"}:${r.n}`).join(" ") : "none yet"}; JOT ${jt.length ? jt.map((r: any) => `${r.d ?? "no-defect"}:${r.n}`).join(" ") : "none yet"}`);
    }
  } catch { /* best-effort */ }
  // COMMERCIAL / DOWNSTREAM: what shipped, what is on hold, and what is sitting
  // in stock by design. The pack was production-only before this, so anything
  // about dispatch or stock depth got "no data".
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const db = prisma as any;
    const [disp, byDesign]: any[][] = await Promise.all([
      db.$queryRaw`
        SELECT to_char(at + interval '330 minutes', 'YYYY-MM-DD') d, count(*)::int n,
               count(DISTINCT slab_number)::int slabs
        FROM fg_slab_event WHERE kind = 'dispatch' AND at > now() - interval '7 days'
        GROUP BY 1 ORDER BY 1 DESC`,
      db.$queryRaw`
        SELECT design, count(*)::int n FROM fg_finished_slab
        WHERE status <> 'DISPATCHED' AND design IS NOT NULL
        GROUP BY 1 ORDER BY 2 DESC LIMIT 12`,
    ]);
    // No "open PI commitments" line: RESERVED and PACKED are never used in this
    // database (16,930 slabs are 13,307 AVAILABLE + 3,623 DISPATCHED, and
    // reserved_at is set on none of them), so that query could only ever return
    // nothing. Slabs go straight from available to dispatched here.
    if (disp.length) lines.push("DISPATCHED PER DAY (last 7 days, IST): "
      + disp.map((r: any) => `${r.d}:${r.slabs}`).join(" "));
    if (byDesign.length) lines.push("STOCK ON HAND BY DESIGN (not dispatched, top 12): "
      + byDesign.map((r: any) => `${r.design}:${r.n}`).join("; "));
  } catch { /* best-effort */ }
  // SHIFT COMPARISON — answers "which shift did better", "how is C doing vs A",
  // without the reader running /shift three times. Anchored on the RUNNING
  // shift's own start date, not the IST calendar date: a C shift after midnight
  // started yesterday, so keying off today would show three empty shifts for
  // the whole of the small hours.
  try {
    const { anchor } = currentShiftAnchor();
    const shifts = await Promise.all((["A", "B", "C"] as const).map((s) =>
      getShiftReport(anchor, s).catch(() => null)));
    const parts = shifts.filter(Boolean).map((r) => {
      const x = r as NonNullable<typeof r>;
      return `${x.shift}: pressed ${x.slabs}, polished ${x.polished} (A${x.gradeA}/B${x.gradeB}/C${x.gradeC}), ${x.hoursLogged}/${x.hoursTotal} hrs logged, downtime ${x.delayMin}min${x.prodIncharge ? `, incharge ${x.prodIncharge}` : ""}`;
    });
    if (parts.length) lines.push(`SHIFTS THIS PRODUCTION DAY (started ${anchor}, IST): ` + parts.join(" | "));
  } catch { /* best-effort */ }
  // Known-design matching, shared by the quality design comparison and the
  // ASKED DESIGNS stock lines below (one catalogue query instead of two).
  let designHits: string[] = [];
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const db = prisma as any;
    // LIMIT 1000: the live catalogue already has 408 distinct designs — the
    // old 300 cap silently made later-alphabet designs unmatchable
    const designs: any[] = await db.$queryRaw`SELECT DISTINCT design FROM fg_finished_slab WHERE design IS NOT NULL ORDER BY design LIMIT 1000`;
    const qLower = question.toLowerCase();
    designHits = designs.map((d: any) => String(d.design)).filter((d) => d.length >= 4 && qLower.includes(d.toLowerCase())).slice(0, 2);
  } catch { /* best-effort */ }
  // QUALITY ROOT-CAUSE: quality-flavoured wording gets deterministic
  // comparison packs — the server does all the math, the model only reasons
  // over the deltas. Subjects: the FIRST named batch (3-4 digits), named
  // slab numbers (5-7 digits, up to 3) each vs its batch's good group, and
  // the first named design (pooled recent batches + per-batch bad rates).
  // Each subject is independently caught so one failing degrades to the rest.
  try {
    if (QUALITY_RE.test(question)) {
      const sections: string[] = [];
      const key = (question.match(/\b[A-Za-z]{0,2}(\d{3,4})\b/) ?? [])[1];
      if (key) sections.push(await qualityComparisonPack(key).catch(() => ""));
      const slabNos = [...new Set(question.match(/\b\d{5,7}\b/g) ?? [])].slice(0, 3).map(Number);
      for (const n of slabNos) sections.push(await slabComparisonPack(n).catch(() => ""));
      // most-specific (longest) catalogue hit first: "Carrara Royale" must
      // beat its prefix design "Carrara Royal"; fall through until one has data
      for (const d of [...designHits].sort((a, b) => b.length - a.length)) {
        const dp = await designComparisonPack(d).catch(() => "");
        if (dp) { sections.push(dp); break; }
      }
      let cmp = sections.filter(Boolean).join("\n");
      // combined cap: the batch block keeps its own 9000-char cap and each
      // slab/design block its 6000 — together capped at 12000 chars (~3k
      // tokens), the modest raise over 9000 for the multi-subject case
      if (cmp.length > 12000) cmp = cmp.slice(0, 12000) + "…";
      if (cmp) lines.push(cmp);
    }
  } catch { /* degrades to the existing pack */ }
  // ASKED SLABS: 5-7 digit numbers = slab numbers -> full journey per slab
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const db = prisma as any;
    const slabs = [...new Set(question.match(/\b\d{5,7}\b/g) ?? [])].slice(0, 3).map(Number);
    const thickAsked = slabs.length ? await thicknessBySlab({ slabs }) : new Map<number, string>();
    for (const n of slabs) {
      const [pr, jt, qc, fg]: any[][] = await Promise.all([
        db.$queryRaw`SELECT batch, design_name FROM press WHERE slab_number = ${n} LIMIT 1`,
        db.$queryRaw`SELECT slab_defect, bend_mm, design_name FROM jot WHERE slab_number = ${n} ORDER BY imported_at DESC LIMIT 1`,
        db.$queryRaw`SELECT quality_grade, repolish_status, rw_status FROM polish_qc WHERE slab_number = ${n} ORDER BY imported_at DESC LIMIT 1`,
        db.$queryRaw`SELECT status, bay_number, design FROM fg_finished_slab WHERE slab_number = ${n} LIMIT 1`,
      ]);
      if (!(pr.length || jt.length || qc.length || fg.length)) continue;
      const dsg = pr[0]?.design_name ?? jt[0]?.design_name ?? fg[0]?.design ?? null;
      lines.push(`ASKED SLAB ${n}: design ${dsg ?? "unknown"}; thickness ${thickAsked.get(n) ?? "not recorded"}; press ${pr[0] ? `batch ${pr[0].batch ?? "?"}` : "no entry"}; JOT ${jt[0] ? (jt[0].slab_defect ?? "no defect") : "no entry"}; QC ${qc[0] ? `${qc[0].quality_grade ?? "ungraded"}${qc[0].repolish_status ? ` ${qc[0].repolish_status}` : ""}` : "no entry"}; stock ${fg[0] ? `${fg[0].status} ${fg[0].bay_number ?? ""}`.trim() : "not in finished goods"}`);
    }
  } catch { /* best-effort */ }
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const db = prisma as any;
    // ASKED DESIGNS: stock + recent output for the matched design names
    for (const d of designHits) {
      const [fg, pr]: any[][] = await Promise.all([
        db.$queryRaw`SELECT status, count(*)::int n FROM fg_finished_slab WHERE design = ${d} GROUP BY 1`,
        db.$queryRaw`SELECT count(DISTINCT slab_number)::int n FROM press WHERE design_name ILIKE ${d} AND imported_at > now() - interval '10 days'`,
      ]);
      lines.push(`ASKED DESIGN ${d}: stock ${fg.map((r: any) => `${r.status}:${r.n}`).join(" ") || "none"}; pressed last 10d: ${pr[0]?.n ?? 0}`);
    }
  } catch { /* best-effort */ }
  return lines.join("\n");
}

// ---- Quality root-cause comparison packs -----------------------------------
// "/ask why did 1376 have so many rejects?" → we split the batch's slabs into
// bad (polish QC grade C* OR a JOT defect) vs good (graded, defect-free), pull
// every numeric per-slab parameter (press settings + JOT thickness/bend) for
// both groups, and compute group means + relative deltas SERVER-SIDE so the
// model reasons over verified numbers instead of doing arithmetic. Batch-level
// context (mixer weights, distributor/kreos line settings, silo bags fed) is
// appended as means. Any failure returns "" and the normal pack still answers.
// The same machinery also serves two more subjects: a named SLAB (its own
// params vs its batch's good-group mean) and a named DESIGN (recent batches
// pooled, bad-vs-good across the pool + per-batch bad rates). Those blocks
// carry NO per-batch mixer/line/silo detail — that context differs per batch,
// so it stays exclusive to the batch block.
const QUALITY_RE = /defect|reject|qc|grade|param|why|cause|analy|compare/i;
// Numeric column lists mirror prisma/schema.prisma (verified against
// information_schema on the live DB); temp_c aliases the long press
// temperature column, entry_hour_ist is derived from imported_at.
const PRESS_NUM_COLS = ["in_time", "slab_weight", "temp_c", "no_of_vacuum_pumps", "no_of_stages", "vacuum_delay_in_seconds", "lowe_chamber_vacuum_in_mbar", "pinhole_cycle_delay", "phase_1_rev", "phase_2_rev", "phase_3_rev", "phase_4_rev", "phase_5_rev", "phase_1_pressing_time", "phase_2_pressing_time", "phase_3_pressing_time", "phase_4_pressing_time", "phase_5_pressing_time", "phase_1_acceleration_time", "phase_2_acceleration_time", "phase_3_acceleration_time", "phase_4_acceleration_time", "phase_5_acceleration_time", "phase_1_pressure", "phase_2_pressure", "phase_3_pressure", "phase_4_pressure", "phase_5_pressure", "cycle_time_sec", "entry_hour_ist"];
const JOT_NUM_COLS = ["thickness_at_1", "thickness_at_2", "thickness_at_3", "thickness_at_4", "thickness_at_5", "thickness_at_6", "thickness_at_7", "thickness_at_8", "bend_mm"];
const MIXER_NUM_COLS = ["loc", "m1_f_w", "m2_f_w", "m3_f_w", "m4_f_w", "m1_w1", "m1_w2", "m1_w3", "m1_w4", "m1_w5", "m2_w1", "m2_w2", "m2_w3", "m2_w4", "m2_w5", "m3_w1", "m3_w2", "m3_w3", "m3_w4", "m3_w5", "m4_w1", "m4_w2", "m4_w3", "m4_w4", "m4_w5", "m1_r_w", "m2_r_w", "m3_r_w", "m4_r_w", "total_cycle_weight"];
const DIST_NUM_COLS = ["loading_material_p1_w", "loading_material_p2_w", "vein_dropped", "vein_remaining", "crusher_loading_belt_loading_speed", "crusher_loading_belt_unloading_speed", "roller_1_rpm", "roller_2_rpm", "lump_crusher_gap", "s1", "e1", "s2", "e2", "distributor_vein_1_batcher_rpm", "distributor_vein_2_batcher_rpm", "distributor_loading_belt_loading_speed", "distributor_loading_belt_unloading_speed", "distributor_material_unloading_speed", "distributor_fractionator_speed", "distributor_hopper_gap", "distributor_hopper_weight", "distributor_manual_roller_height", "shuttle_speed_p1", "shuttle_speed_p2"];
const KREOS_NUM_COLS = ["slab_weight", "load_on_mobile_roller_rx_side_kg", "load_on_mobile_roller_lx_side_kg", "crusher_loading_belt_speed_in_m_min", "crusher_unloading_belt_speed_in_m_min_copy", "roller_1_rpm", "roller_2_rpm", "lump_crusher_gap", "gev_1_slot_size", "gev_1_rpm", "gev_2_slot_size", "gev_2_rpm", "gev_3_slot_size", "gev_3_rpm", "kreos_working_position_in_mm", "slab_set_weight", "lamination_speed", "belt_rotation_k1", "fixed_roller_rotation_k2", "mobile_roller_rotation_k3", "distributor_loading_belt_loading_speed", "distributor_loading_belt_unloading_speed", "chessboard_body_percentage"];

type NumRow = Record<string, unknown>;
// compact rounding so the pack stays small: 0dp ≥100, 1dp ≥10, 2dp ≥1, else 3dp
const rnd = (x: number): string => {
  const a = Math.abs(x);
  const s = x.toFixed(a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : 3);
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
};
const asNum = (v: unknown): number | null => {
  const x = typeof v === "number" ? v : v == null ? NaN : Number(v);
  return Number.isFinite(x) ? x : null;
};
function colMeans(rows: NumRow[], cols: string[]): Map<string, { mean: number; n: number }> {
  const out = new Map<string, { mean: number; n: number }>();
  for (const c of cols) {
    let s = 0, n = 0;
    for (const r of rows) { const x = asNum(r[c]); if (x !== null) { s += x; n++; } }
    if (n) out.set(c, { mean: s / n, n });
  }
  return out;
}
// mean-vs-mean relative difference per column; needs ≥3 values per group by
// default (minBad=1 lets a SINGLE slab's own values stand against the good mean)
function rankDeltas(bad: NumRow[], good: NumRow[], cols: string[], minBad = 3): { c: string; b: number; g: number; pct: number }[] {
  const bm = colMeans(bad, cols), gm = colMeans(good, cols);
  const out: { c: string; b: number; g: number; pct: number }[] = [];
  for (const c of cols) {
    const b = bm.get(c), g = gm.get(c);
    if (!b || !g || b.n < minBad || g.n < 3 || Math.abs(g.mean) < 1e-9) continue;
    const pct = ((b.mean - g.mean) / Math.abs(g.mean)) * 100;
    if (Number.isFinite(pct)) out.push({ c, b: b.mean, g: g.mean, pct });
  }
  return out.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
}
const meansLine = (rows: NumRow[], cols: string[]): string =>
  [...colMeans(rows, cols).entries()].map(([c, m]) => `${c}=${rnd(m.mean)}`).join(" ");
const jsonVal = (v: unknown): string => {
  if (v == null) return "";
  if (Array.isArray(v)) return [...new Set(v.map(String))].slice(0, 3).join("/").slice(0, 40);
  if (typeof v === "object") return "";
  return String(v).slice(0, 40);
};

// Shared fetchers for all three comparison subjects (batch / slab / design).
// Everything is parameterized $queryRaw; keys are always string batch_keys.
type BgRow = { k: string; s: number };
// deterministic even spread when a pool exceeds the cap
const evenSample = <T>(arr: T[], cap: number): T[] =>
  arr.length <= cap ? arr : Array.from({ length: cap }, (_, i) => arr[Math.floor(i * (arr.length / cap))]);
// bad = polish-QC grade C* or JOT defect; good = graded, and NOT bad anywhere
// (NOT EXISTS over the FULL bad definition, not any capped list)
async function badGoodPools(keys: string[], badLimit: number): Promise<{ bad: BgRow[]; good: BgRow[] }> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const db = prisma as any;
  const [bad, good]: any[][] = await Promise.all([
    db.$queryRaw`
      SELECT DISTINCT batch_key k, slab_number::float8 s FROM (
        SELECT batch_key, slab_number FROM polish_qc WHERE batch_key = ANY(${keys}::text[]) AND slab_number IS NOT NULL AND quality_grade ILIKE 'C%'
        UNION
        SELECT batch_key, slab_number FROM jot WHERE batch_key = ANY(${keys}::text[]) AND slab_number IS NOT NULL AND slab_defect IS NOT NULL
      ) t ORDER BY 1, 2 LIMIT ${badLimit}`,
    db.$queryRaw`
      SELECT DISTINCT q.batch_key k, q.slab_number::float8 s FROM polish_qc q
      WHERE q.batch_key = ANY(${keys}::text[]) AND q.slab_number IS NOT NULL
        AND q.quality_grade IS NOT NULL AND q.quality_grade NOT ILIKE 'C%' AND q.quality_grade NOT ILIKE 'Not graded%'
        AND NOT EXISTS (SELECT 1 FROM polish_qc q2 WHERE q2.batch_key = q.batch_key AND q2.slab_number = q.slab_number AND q2.quality_grade ILIKE 'C%')
        AND NOT EXISTS (SELECT 1 FROM jot j WHERE j.batch_key = q.batch_key AND j.slab_number = q.slab_number AND j.slab_defect IS NOT NULL)
      ORDER BY 1, 2 LIMIT 4000`,
  ]);
  const cv = (r: any): BgRow => ({ k: String(r.k), s: Number(r.s) });
  return { bad: bad.map(cv), good: good.map(cv) };
}
// per-slab numeric rows: latest press row per slab + all JOT rows (both capped)
async function pressJotRows(keys: string[], slabs: number[]): Promise<{ press: NumRow[]; jot: NumRow[] }> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const db = prisma as any;
  const [press, jot]: any[][] = await Promise.all([
    db.$queryRaw`
      SELECT DISTINCT ON (slab_number) slab_number::float8 s, in_time, slab_weight,
        temperature_in_degree_celsius_note_only_at_15_00_and_3_00 temp_c,
        no_of_vacuum_pumps, no_of_stages, vacuum_delay_in_seconds, lowe_chamber_vacuum_in_mbar, pinhole_cycle_delay,
        phase_1_rev, phase_2_rev, phase_3_rev, phase_4_rev, phase_5_rev,
        phase_1_pressing_time, phase_2_pressing_time, phase_3_pressing_time, phase_4_pressing_time, phase_5_pressing_time,
        phase_1_acceleration_time, phase_2_acceleration_time, phase_3_acceleration_time, phase_4_acceleration_time, phase_5_acceleration_time,
        phase_1_pressure, phase_2_pressure, phase_3_pressure, phase_4_pressure, phase_5_pressure,
        cycle_time_sec, to_char(imported_at + interval '330 minutes', 'HH24')::int entry_hour_ist
      FROM press WHERE batch_key = ANY(${keys}::text[]) AND slab_number = ANY(${slabs}::float8[])
      ORDER BY slab_number, imported_at DESC`,
    db.$queryRaw`
      SELECT slab_number::float8 s, thickness_at_1, thickness_at_2, thickness_at_3, thickness_at_4,
        thickness_at_5, thickness_at_6, thickness_at_7, thickness_at_8, bend_mm
      FROM jot WHERE batch_key = ANY(${keys}::text[]) AND slab_number = ANY(${slabs}::float8[]) LIMIT 400`,
  ]);
  return { press, jot };
}
// latest QC grade + distinct JOT defects for the given slabs
async function qcGradesAndDefects(keys: string[], slabs: number[]): Promise<{ gradeBy: Map<number, string>; defBy: Map<number, string> }> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const db = prisma as any;
  const [qc, jd]: any[][] = await Promise.all([
    db.$queryRaw`
      SELECT DISTINCT ON (slab_number) slab_number::float8 s, quality_grade
      FROM polish_qc WHERE batch_key = ANY(${keys}::text[]) AND slab_number = ANY(${slabs}::float8[])
      ORDER BY slab_number, imported_at DESC`,
    db.$queryRaw`
      SELECT slab_number::float8 s, string_agg(DISTINCT slab_defect, '/') d
      FROM jot WHERE batch_key = ANY(${keys}::text[]) AND slab_number = ANY(${slabs}::float8[]) AND slab_defect IS NOT NULL GROUP BY 1`,
  ]);
  return {
    gradeBy: new Map<number, string>(qc.map((r: any) => [Number(r.s), String(r.quality_grade ?? "ungraded")])),
    defBy: new Map<number, string>(jd.map((r: any) => [Number(r.s), String(r.d)])),
  };
}

async function qualityComparisonPack(key: string): Promise<string> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const db = prisma as any;
  const pools = await badGoodPools([key], 300);
  const badAll = pools.bad.map((r) => r.s);
  const badSlabs = badAll.slice(0, 40);
  if (!badSlabs.length) return "";
  const goodAll = pools.good.map((r) => r.s);
  const goodSlabs = evenSample(goodAll, 40); // deterministic spread across the batch
  if (!goodSlabs.length) return "";
  const all = [...badSlabs, ...goodSlabs];
  const [{ press, jot }, { gradeBy, defBy }] = await Promise.all([
    pressJotRows([key], all),
    qcGradesAndDefects([key], badSlabs),
  ]);
  const badSet = new Set(badSlabs);
  const inBad = (r: any) => badSet.has(Number(r.s));
  const ranked = [
    ...rankDeltas(press.filter(inBad), press.filter((r: any) => !inBad(r)), PRESS_NUM_COLS),
    ...rankDeltas(jot.filter(inBad), jot.filter((r: any) => !inBad(r)), JOT_NUM_COLS),
  ].sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  const suspects = ranked.filter((d) => Math.abs(d.pct) >= 2); // <2% = noise
  const top = suspects.slice(0, 12);
  const lines: string[] = [];
  lines.push(`COMPARISON PACK BATCH ${key} (bad = polish-QC grade C or JOT defect; good = graded A/B, no defect; all math server-computed):`);
  lines.push(`BAD SLABS (${badAll.length}${badAll.length >= 300 ? "+" : ""} total${badAll.length > 40 ? ", first 40 shown" : ""}): `
    + badSlabs.map((n) => `${n}(${[gradeBy.get(n), defBy.get(n)].filter(Boolean).join("+") || "?"})`).join(" "));
  lines.push(`GOOD SLABS: ${goodAll.length} total, ${goodSlabs.length} sampled for comparison`);
  lines.push(!ranked.length
    ? "PARAM DELTAS: too few per-slab press/JOT rows on one side for a group comparison (need ≥3 slabs with values per side)"
    : top.length
      ? `PARAM DELTAS (bad vs good, ranked by |relative diff|${suspects.length > 12 ? `, top 12 of ${suspects.length}` : ""}${ranked.length > suspects.length ? `; ${ranked.length - suspects.length} params within ±2% = look normal` : ""}): `
        + top.map((d) => `${d.c}: bad avg ${rnd(d.b)} vs good avg ${rnd(d.g)} (${d.pct >= 0 ? "+" : ""}${rnd(d.pct)}%)`).join("; ")
      : `PARAM DELTAS: none of the ${ranked.length} comparable numeric parameters differs by ≥2% between bad and good slabs`);
  const hrs = new Map<number, number>();
  for (const r of press.filter(inBad)) { const h = asNum(r.entry_hour_ist); if (h !== null) hrs.set(h, (hrs.get(h) ?? 0) + 1); }
  if (hrs.size) lines.push("BAD SLAB PRESS-ENTRY HOURS (IST, count per hour — clustering hints at a time-bound cause): "
    + [...hrs.entries()].sort((a, b) => b[1] - a[1]).map(([h, n]) => `${String(h).padStart(2, "0")}:00×${n}`).join(" "));
  try { // batch-level context: mixer weights, line settings, silo bags fed
    const [mixer, dist, kreos]: any[][] = await Promise.all([
      db.$queryRaw`SELECT loc, m1_f_w, m2_f_w, m3_f_w, m4_f_w, m1_w1, m1_w2, m1_w3, m1_w4, m1_w5,
          m2_w1, m2_w2, m2_w3, m2_w4, m2_w5, m3_w1, m3_w2, m3_w3, m3_w4, m3_w5,
          m4_w1, m4_w2, m4_w3, m4_w4, m4_w5, m1_r_w, m2_r_w, m3_r_w, m4_r_w,
          (total_cycle_weight#>>'{}')::float8 total_cycle_weight
        FROM mixer_cycle WHERE batch_key = ${key} LIMIT 300`,
      db.$queryRaw`SELECT loading_material_p1_w, loading_material_p2_w, vein_dropped, vein_remaining,
          crusher_loading_belt_loading_speed, crusher_loading_belt_unloading_speed, roller_1_rpm, roller_2_rpm,
          lump_crusher_gap, s1, e1, s2, e2, distributor_vein_1_batcher_rpm, distributor_vein_2_batcher_rpm,
          distributor_loading_belt_loading_speed, distributor_loading_belt_unloading_speed, distributor_material_unloading_speed,
          distributor_fractionator_speed, distributor_hopper_gap, distributor_hopper_weight, distributor_manual_roller_height,
          shuttle_speed_p1, shuttle_speed_p2
        FROM distributor WHERE batch_key = ${key} LIMIT 400`,
      db.$queryRaw`SELECT slab_weight, load_on_mobile_roller_rx_side_kg, load_on_mobile_roller_lx_side_kg,
          crusher_loading_belt_speed_in_m_min, crusher_unloading_belt_speed_in_m_min_copy, roller_1_rpm, roller_2_rpm,
          lump_crusher_gap, gev_1_slot_size, gev_1_rpm, gev_2_slot_size, gev_2_rpm, gev_3_slot_size, gev_3_rpm,
          kreos_working_position_in_mm, slab_set_weight, lamination_speed, belt_rotation_k1, fixed_roller_rotation_k2,
          mobile_roller_rotation_k3, distributor_loading_belt_loading_speed, distributor_loading_belt_unloading_speed,
          chessboard_body_percentage
        FROM kreos WHERE batch_key = ${key} LIMIT 400`,
    ]);
    if (mixer.length) lines.push(`MIXER CYCLES (${mixer.length} rows, batch-level means): ` + meansLine(mixer, MIXER_NUM_COLS));
    if (dist.length) lines.push(`DISTRIBUTOR (${dist.length} rows, means): ` + meansLine(dist, DIST_NUM_COLS));
    if (kreos.length) lines.push(`KREOS (${kreos.length} rows, means): ` + meansLine(kreos, KREOS_NUM_COLS));
  } catch { /* batch-level context is optional */ }
  try { // silo bags consumed: mixer grit/filler id arrays -> silo rows
    const sids: any[] = await db.$queryRaw`
      SELECT DISTINCT unnest(m1_g1 || m1_g2 || m1_g3 || m1_g4 || m1_g5 || m2_g1 || m2_g2 || m2_g3 || m2_g4 || m2_g5
        || m3_g1 || m3_g2 || m3_g3 || m3_g4 || m3_g5 || m4_g1 || m4_g2 || m4_g3 || m4_g4 || m4_g5 || filler_silo_id) aid
      FROM mixer_cycle WHERE batch_key = ${key}`;
    const aids = sids.map((r) => String(r.aid)).filter(Boolean).slice(0, 200);
    if (aids.length) {
      const silos: any[] = await db.$queryRaw`
        SELECT silo_no, sku, size_from_used_bag sz, grade_from_used_bag gr, type_from_used_bag ty,
               name_from_supplier_master_from_used_bag sup
        FROM silo WHERE "airtableId" = ANY(${aids}) LIMIT 60`;
      const seen = new Set<string>();
      for (const r of silos) {
        seen.add(`${r.silo_no ?? "?"}:${r.sku ?? "?"}` + [["sz", r.sz], ["gr", r.gr], ["ty", r.ty], ["sup", r.sup]]
          .map(([k, v]) => { const t = jsonVal(v); return t ? ` ${k}=${t}` : ""; }).join(""));
      }
      if (seen.size) lines.push(`SILOS/BAGS FED INTO MIXER (${seen.size}): ` + [...seen].slice(0, 20).join("; "));
    }
  } catch { /* silo context is optional */ }
  let pack = lines.join("\n");
  if (pack.length > 9000) pack = pack.slice(0, 9000) + "…"; // hard cap ≈2.3k tokens
  return pack;
}

// SLAB comparison: the named slab's own per-slab numbers (latest press row,
// its JOT thickness/bend readings) each against its batch's good-group mean
// (slab itself excluded), ranked by |relative diff| — top 10, same ±2% noise
// floor. States the slab's QC grade / JOT defect and which side of the
// bad/good split it falls on, so it works for good slabs too. Batch-level
// mixer/line/silo context is NOT repeated here — when the question also names
// the batch, the batch comparison block carries it.
async function slabComparisonPack(slabNo: number): Promise<string> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const db = prisma as any;
  const bk: any[] = await db.$queryRaw`
    SELECT batch_key FROM (
      SELECT batch_key, imported_at FROM press WHERE slab_number = ${slabNo} AND batch_key IS NOT NULL
      UNION ALL
      SELECT batch_key, imported_at FROM jot WHERE slab_number = ${slabNo} AND batch_key IS NOT NULL
      UNION ALL
      SELECT batch_key, imported_at FROM polish_qc WHERE slab_number = ${slabNo} AND batch_key IS NOT NULL
    ) t ORDER BY imported_at DESC LIMIT 1`;
  const key = bk[0]?.batch_key ? String(bk[0].batch_key) : "";
  if (!key) return "";
  const [pools, gd] = await Promise.all([badGoodPools([key], 300), qcGradesAndDefects([key], [slabNo])]);
  const grade = gd.gradeBy.get(slabNo);
  const defect = gd.defBy.get(slabNo);
  const isBad = /^c/i.test(grade ?? "") || !!defect;
  const status = `QC grade ${grade ?? "none yet"}; JOT ${defect ? `defect ${defect}` : "no defect logged"} — ${isBad ? "a BAD slab in the bad/good split" : /^[ab]/i.test(grade ?? "") ? "a GOOD slab (deltas below show how it still sits vs the good average)" : "not yet graded (deltas below compare it to the good average)"}`;
  const goodAll = pools.good.map((r) => r.s).filter((s) => s !== slabNo);
  const head = `SLAB ${slabNo} VS ITS BATCH'S GOOD SLABS (batch ${key}; good = graded A/B no defect, ${goodAll.length} slabs${goodAll.length > 40 ? ", 40 sampled" : ""}, this slab excluded; all math server-computed):`;
  if (!goodAll.length) return `${head}\nSLAB STATUS: ${status}\nPARAM DELTAS: the batch has no good-graded defect-free slabs yet, so there is no good group to compare against`;
  const goodSlabs = evenSample(goodAll, 40);
  const { press, jot } = await pressJotRows([key], [slabNo, ...goodSlabs]);
  const mine = (r: any) => Number(r.s) === slabNo;
  const hasOwn = press.some(mine) || jot.some(mine);
  const ranked = [
    ...rankDeltas(press.filter(mine), press.filter((r: any) => !mine(r)), PRESS_NUM_COLS, 1),
    ...rankDeltas(jot.filter(mine), jot.filter((r: any) => !mine(r)), JOT_NUM_COLS, 1),
  ].sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  const suspects = ranked.filter((d) => Math.abs(d.pct) >= 2);
  const top = suspects.slice(0, 10);
  const deltas = !hasOwn
    ? "PARAM DELTAS: no per-slab press/JOT parameter rows recorded for this slab"
    : !ranked.length
      ? "PARAM DELTAS: not enough good-group parameter rows for a comparison (need ≥3 good slabs with values)"
      : top.length
        ? `PARAM DELTAS (this slab vs good-group mean, ranked by |relative diff|${suspects.length > 10 ? `, top 10 of ${suspects.length}` : ""}${ranked.length > suspects.length ? `; ${ranked.length - suspects.length} params within ±2% = look normal` : ""}): `
          + top.map((d) => `${d.c}: slab ${rnd(d.b)} vs good avg ${rnd(d.g)} (${d.pct >= 0 ? "+" : ""}${rnd(d.pct)}%)`).join("; ")
        : `PARAM DELTAS: all ${ranked.length} comparable parameters are within ±2% of the good-group average`;
  let pack = [head, `SLAB STATUS: ${status}`, deltas].join("\n");
  if (pack.length > 6000) pack = pack.slice(0, 6000) + "…"; // ≈1.5k tokens per subject block
  return pack;
}

// DESIGN comparison: pool the design's press batches from the last ~60 days
// (newest 10), run the SAME bad-vs-good delta math across the pooled slabs
// (40-per-side caps, even-sampled across the pool), and lead with a per-batch
// bad-rate line so a single rogue batch stands out from a design-wide issue.
// Mixer/distributor/kreos/silo detail is deliberately absent — it differs per
// batch, so it lives in the batch block (ask about the batch to get it).
async function designComparisonPack(design: string): Promise<string> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const db = prisma as any;
  const batches: any[] = await db.$queryRaw`
    SELECT batch_key k, count(DISTINCT slab_number)::int n
    FROM press
    WHERE design_name ILIKE ${design} AND batch_key IS NOT NULL AND imported_at > now() - interval '60 days'
    GROUP BY 1 ORDER BY max(imported_at) DESC LIMIT 10`;
  const keys = batches.map((b) => String(b.k));
  if (!keys.length) return "";
  // denominator = the batch's ALL-TIME press count: the 60-day window only
  // picks WHICH batches; bad counts are all-time, so a windowed denominator
  // could show impossible rates like "15/13" for older re-imported batches
  const [{ bad, good }, totals]: [Awaited<ReturnType<typeof badGoodPools>>, any[]] = await Promise.all([
    badGoodPools(keys, 2000),
    db.$queryRaw`SELECT batch_key k, count(DISTINCT slab_number)::int n FROM press WHERE batch_key = ANY(${keys}::text[]) GROUP BY 1`,
  ]);
  const pressedBy = new Map<string, number>(totals.map((t: any) => [String(t.k), Number(t.n)]));
  const badBy = new Map<string, number>();
  for (const r of bad) badBy.set(r.k, (badBy.get(r.k) ?? 0) + 1);
  const atCap = bad.length >= 2000;
  const rateLine = [...batches]
    .sort((a, b) => String(a.k).localeCompare(String(b.k), undefined, { numeric: true }))
    .map((b) => `${b.k}: ${badBy.get(String(b.k)) ?? 0}${atCap ? "+" : ""}/${pressedBy.get(String(b.k)) || "?"} bad`).join(", ");
  const lines: string[] = [];
  lines.push(`DESIGN COMPARISON PACK ${design} (press batches from the last 60 days${batches.length >= 10 ? ", newest 10" : ""}; bad = polish-QC grade C or JOT defect, good = graded A/B no defect; all math server-computed):`);
  lines.push(`BAD RATE BY BATCH (bad/pressed): ${rateLine}`);
  const badPool = evenSample(bad.map((r) => r.s), 40);
  const goodPool = evenSample(good.map((r) => r.s), 40);
  if (badPool.length && goodPool.length) {
    const { press, jot } = await pressJotRows(keys, [...badPool, ...goodPool]);
    const badSet = new Set(badPool);
    const inBad = (r: any) => badSet.has(Number(r.s));
    const ranked = [
      ...rankDeltas(press.filter(inBad), press.filter((r: any) => !inBad(r)), PRESS_NUM_COLS),
      ...rankDeltas(jot.filter(inBad), jot.filter((r: any) => !inBad(r)), JOT_NUM_COLS),
    ].sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
    const suspects = ranked.filter((d) => Math.abs(d.pct) >= 2);
    const top = suspects.slice(0, 12);
    lines.push(`POOLED SLABS: ${bad.length}${atCap ? "+" : ""} bad (${badPool.length} compared) vs ${good.length} good (${goodPool.length} compared), sampled evenly across the batches`);
    lines.push(!ranked.length
      ? "PARAM DELTAS: too few per-slab press/JOT rows on one side for a group comparison (need ≥3 slabs with values per side)"
      : top.length
        ? `PARAM DELTAS (pooled bad vs good, ranked by |relative diff|${suspects.length > 12 ? `, top 12 of ${suspects.length}` : ""}${ranked.length > suspects.length ? `; ${ranked.length - suspects.length} params within ±2% = look normal` : ""}): `
          + top.map((d) => `${d.c}: bad avg ${rnd(d.b)} vs good avg ${rnd(d.g)} (${d.pct >= 0 ? "+" : ""}${rnd(d.pct)}%)`).join("; ")
        : `PARAM DELTAS: none of the ${ranked.length} comparable numeric parameters differs by ≥2% between pooled bad and good slabs`);
  } else {
    lines.push(badPool.length
      ? "POOLED SLABS: no good-graded defect-free slabs in these batches yet — nothing to compare against"
      : "POOLED SLABS: no bad slabs (QC grade C / JOT defect) in these batches — nothing to contrast; the bad-rate line above is the story");
  }
  let pack = lines.join("\n");
  if (pack.length > 6000) pack = pack.slice(0, 6000) + "…"; // ≈1.5k tokens per subject block
  return pack;
}

// Telegram parses our messages as HTML and rejects the WHOLE message with
// 400 "can't parse entities" on any tag it doesn't know — so we never pass the
// model's text through as markup. Everything is escaped first, then a small
// fixed set of conversions is applied to the already-escaped text. That order
// makes a parse failure structurally impossible: the only tags that can reach
// Telegram are the ones written here.
const BULLET = "•";
// Budget for the ESCAPED TEXT, before the conversions below expand it into
// tags. Truncating afterwards was a bug: a cut landing between <b> and </b>
// left the tag unclosed and Telegram dropped the whole message. Cutting first,
// at a line boundary, means every tag the conversions emit is balanced by
// construction — the emphasis regexes only ever match a closed pair, and they
// cannot span a newline. 3000 leaves ample room for tag expansion under
// Telegram's 4096 limit.
const MAX_TEXT = 3000;
function truncateSafely(s: string): string {
  if (s.length <= MAX_TEXT) return s;
  const nl = s.lastIndexOf("\n", MAX_TEXT);
  if (nl > MAX_TEXT * 0.5) return s.slice(0, nl) + "\n…";
  // One very long line: cut mid-line, but never between the halves of a
  // surrogate pair or the message becomes invalid UTF-16.
  let cut = MAX_TEXT;
  const c = s.charCodeAt(cut - 1);
  if (c >= 0xd800 && c <= 0xdbff) cut -= 1;
  return s.slice(0, cut) + "…";
}
function formatForTelegram(raw: string): string {
  const lines = truncateSafely(esc(raw).trim())
    .split("\n")
    .map((line) => {
      let s = line.trimEnd();
      // "- x" / "* x" / "1. x" -> bullet. The model is asked for these, but it
      // also reaches for markdown on its own; normalise both.
      s = s.replace(/^\s*[-*]\s+/, `${BULLET} `);
      s = s.replace(/^\s*(\d{1,2})[.)]\s+/, `$1. `);
      // "## Heading" -> bold line
      s = s.replace(/^\s*#{1,6}\s*(.+)$/, "<b>$1</b>");
      return s;
    });
  const plain = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const out = plain
    // **bold** and __bold__ -> <b>. Applied after escaping, so the asterisks
    // are literal text by now and cannot interact with any real markup.
    .replace(/\*\*([^\n*]{1,200}?)\*\*/g, "<b>$1</b>")
    .replace(/__([^\n_]{1,200}?)__/g, "<b>$1</b>")
    // `code` -> <code>
    .replace(/`([^\n`]{1,200}?)`/g, "<code>$1</code>")
    .trim();
  // Last line of defence. The two conversions above are independent passes, so
  // markers that INTERLEAVE on one line — bold opens, code opens, bold closes,
  // code closes — emit crossed tags (<b>..<code>..</b>..</code>) rather than
  // nested ones, and Telegram rejects the whole message for that. Rather than
  // enumerate every way markers can cross, check the result: if the markup is
  // not well formed, send the text with no markup at all. A plainer message
  // always beats one the group never sees.
  return capToLimit(isWellFormed(out) ? out : stripTags(plain));
}
const stripTags = (s: string) => s.replace(/<\/?[a-z]+>/g, "");
/** Every tag properly closed and nested, and nothing outside what we emit. */
function isWellFormed(html: string): boolean {
  const allowed = new Set(["b", "code"]);
  const stack: string[] = [];
  for (const m of html.matchAll(/<(\/?)([a-z]*)>/g)) {
    const [, slash, name] = m;
    if (!allowed.has(name)) return false;
    if (slash) { if (stack.pop() !== name) return false; }
    else stack.push(name);
  }
  return stack.length === 0;
}
// Conversions expand the text — `x` becomes <code>x</code>, so a dense line can
// grow several-fold and overshoot Telegram's 4096 even after the pre-truncation
// above. Cut on a line boundary: every emphasis regex excludes \n, so no tag can
// span one and a newline cut can never split a tag. If a single line is somehow
// still too long, fall back to the tagless text — a plainer message beats one
// Telegram refuses to deliver.
const MAX_MSG = 4000;
function capToLimit(html: string): string {
  if (html.length <= MAX_MSG) return html;
  const nl = html.lastIndexOf("\n", MAX_MSG);
  if (nl > 0) return html.slice(0, nl) + "\n…";
  return html.replace(/<[^>]*>/g, "").slice(0, MAX_MSG - 1) + "…";
}

// ---- The answering model ---------------------------------------------------
// Sonnet 5 rather than Haiku: the pack is a large labelled document and most
// real questions need it read carefully (cross-referencing press vs MIS, or
// reasoning over the server-computed deltas) rather than looked up. Sonnet is
// ~3x Haiku per token, which is the "little more per prompt" this was asked to
// cost. Sampling parameters are not accepted on this model, so tone is steered
// entirely by the prompt below.
const ASK_MODEL = "claude-sonnet-5";

const ANSWER_STYLE = [
  "HOW TO WRITE THE ANSWER",
  "- Lead with the direct answer in ONE line. The reader is on a phone in a factory.",
  "- Then supporting detail as bullets, one fact per line, starting with \"- \".",
  "- Put the number first in a bullet, then what it is: \"- 112 slabs pressed (shift A)\".",
  "- Wrap the key figure of each bullet in **double asterisks** and nothing else. Never bold a whole line.",
  "- No headings, no tables, no nested bullets, no markdown links. Plain lines only.",
  "- 6 bullets maximum for a normal question. If more seems needed, you are answering a question that was not asked.",
  "- Never restate the question, never open with \"Based on the data\" or \"Here is\".",
  "- Round sensibly: whole slabs, whole minutes, one decimal for percentages.",
  "- Name the source when it matters: say \"press\" or \"MIS log\" so the reader knows which number they are getting.",
  "",
  "WHEN YOU CANNOT ANSWER",
  "- Say exactly which figure is missing, in one line. Do not estimate, do not hedge with maybes.",
  "- Then point at what would have it: /status, /shift, /day, or the ERP dashboard.",
].join("\n");

const DATA_RULES = [
  "READING THE DATA PACK",
  "- PRESS MACHINE TOTALS are the authoritative slab count per batch. For any batch total, use press — never MIS.",
  "- MIS lines are the manual hourly log and are often incomplete (hours logged with no count). Treat MIS as what was written down, press as what happened.",
  "- Asked about problems or discrepancies? Compare the two: name batches where MIS logged materially fewer slabs than press recorded, and the hours missing counts.",
  "- LAST ~75min and LATEST ENTRY lines answer anything phrased as latest / just now / last hour / most recent.",
  "- BY HOUR lines answer any time-window question for today and yesterday (times are IST).",
  "- Thickness (2 cm vs 3 cm) comes only from SLAB THICKNESS BY BATCH and the thickness field on ASKED BATCH / ASKED SLAB. It is stamped at Distributor/Kreos, the polish stations and Jot — never at the press or the oven. A slab shown as 'not recorded' simply has no thickness stamped anywhere: say that plainly rather than guessing.",
  "- Every number you give must appear in the pack or be a difference between two numbers in it. Never carry in outside knowledge of what a normal machine setting looks like.",
].join("\n");

const ANALYSIS_RULES = [
  "",
  "QUALITY / ROOT-CAUSE QUESTIONS",
  "This question shipped one or more server-computed comparison blocks: COMPARISON PACK BATCH (a batch's bad vs good slabs), SLAB n VS ITS BATCH'S GOOD SLABS (one slab against its batch's good-group mean), DESIGN COMPARISON PACK (a design's recent batches pooled, led by per-batch bad rates).",
  "PARAM DELTAS in those blocks were already calculated on the server (% = relative difference from the good-group mean). Reason from them; never recompute an average yourself.",
  "Answer in this order, still as bullets:",
  "1. The strongest suspects — biggest |%| deltas — each with both numbers. Mention press-hour clustering if present. If a design block's bad rates single out one batch, name that batch.",
  "2. What looks normal (the parameters within ±2%), in one line.",
  "3. One line, plain words: these are correlations in logged data, not proven causes.",
  "4. One or two concrete physical checks someone can actually go and do — a station to inspect for the clustered hours, specific slabs to pull, silo bags to trace.",
  "Up to 12 bullets for this kind of question.",
].join("\n");

export async function aiAnswer(question: string): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return "🤖 Free-text questions aren't switched on yet (no AI key configured). The command reports still work: /status /shift /day /yesterday";
  try {
    const pack = await dataPack(question);
    // Quality investigations carry server-computed comparison blocks and need
    // real reasoning over them, so they get thinking, more effort and a bigger
    // answer budget. Everything else runs thinking-off for chat latency — the
    // group is waiting on the reply.
    const hasCmp = /COMPARISON PACK BATCH|DESIGN COMPARISON PACK|VS ITS BATCH'S GOOD SLABS/.test(pack);
    // The route's maxDuration is 60s. Give up on the model well before that so
    // the catch below can still send a reply — a platform timeout would kill the
    // function outright and the group would just get silence.
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 40_000);
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: abort.signal,
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: ASK_MODEL,
        // max_tokens caps thinking AND text together, so a tight ceiling on the
        // thinking path truncates the answer mid-bullet. Unused budget is never
        // billed, so the headroom is free — and the 40s abort above, not this
        // number, is what actually bounds a runaway.
        max_tokens: hasCmp ? 16000 : 1200,
        thinking: hasCmp ? { type: "adaptive" } : { type: "disabled" },
        output_config: { effort: hasCmp ? "high" : "medium" },
        system:
          "You are the Pacific Surfaces factory ERP assistant, answering questions in the plant's Telegram group. "
          + "The people reading you are production, quality and office staff — not engineers. "
          + "Answer ONLY from the production data provided. Never invent a number.\n\n"
          + DATA_RULES + "\n\n" + ANSWER_STYLE + (hasCmp ? "\n" + ANALYSIS_RULES : ""),
        messages: [{ role: "user", content: `Production data:\n${pack}\n\nQuestion: ${question.slice(0, 500)}` }],
      }),
    }).finally(() => clearTimeout(timer));
    if (!res.ok) { console.error("aiAnswer API", res.status, await res.text().catch(() => "")); return "🤖 Couldn't reach the AI service — try again in a minute."; }
    const j = await res.json();
    // Thinking blocks come back alongside text on the comparison path — take
    // only the text, or the reply leads with reasoning.
    const text = (j?.content ?? [])
      .filter((c: { type?: string }) => c?.type === "text")
      .map((c: { text?: string }) => c.text ?? "").join("").trim();
    // stop_reason has to be read, not assumed. On the thinking path the token
    // budget covers thinking AND the answer, so a hard question can return a
    // 200 whose text is cut mid-bullet — posting that unmarked would put half a
    // set of factory numbers in the group looking complete. An empty body needs
    // its own message too: "try rephrasing" sends the reader straight back into
    // the same path, which fails the same way.
    const stop = j?.stop_reason;
    if (stop === "refusal")
      return "🤖 I can't answer that one. Ask about production, quality or dispatch and I'll pull the numbers.";
    if (!text)
      return stop === "max_tokens"
        ? "🤖 That needed more working-out room than I have. Narrow it to one batch, slab or day."
        : "🤖 No answer came back — try rephrasing.";
    if (stop === "max_tokens")
      return formatForTelegram(text + "\n\n…cut short — ask about one batch, slab or day at a time.");
    return formatForTelegram(text);
  } catch (e) {
    console.error("aiAnswer error:", e);
    if ((e as { name?: string })?.name === "AbortError")
      return "🤖 That one took too long to work out. Try asking it more narrowly — name the batch, slab or day you mean.";
    return "🤖 Something went wrong answering that — the command reports still work.";
  }
}
