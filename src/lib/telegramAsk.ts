// Free-text questions from the Telegram group ("/ask how many slabs did we
// lose to downtime this week?"). We do NOT let the model touch the DB — we
// hand it a compact pack of live production numbers and it answers from that.
// Needs ANTHROPIC_API_KEY in env; soft-fails with a friendly message without it.
import { prisma } from "@/lib/prisma";
import { getDowntimeReport } from "@/lib/downtime";
import { getLastShiftReport } from "@/lib/misShift";
import { ymdIST, plusDay, lastCompletedHourIST, hourlyMessage } from "@/lib/telegramReports";
import { esc } from "@/lib/telegram";

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
      const [pr, mi, qc, jt]: any[][] = await Promise.all([
        db.$queryRaw`SELECT count(DISTINCT slab_number)::int n, min(slab_number)::int lo, max(slab_number)::int hi FROM press WHERE batch ILIKE ${like}`,
        db.$queryRaw`SELECT sum(slabs_per_hour_actual)::float s, count(*) FILTER (WHERE slabs_per_hour_actual IS NULL)::int miss FROM mis WHERE batch ILIKE ${like}`,
        db.$queryRaw`SELECT quality_grade g, count(*)::int n FROM polish_qc WHERE batch_key = ${k} OR batch_number ILIKE ${like} GROUP BY 1`,
        db.$queryRaw`SELECT slab_defect d, count(*)::int n FROM jot WHERE batch ILIKE ${like} GROUP BY 1`,
      ]);
      if (!(pr[0]?.n || mi[0]?.s || qc.length || jt.length)) continue;
      lines.push(`ASKED BATCH ${k} (all-time detail): press ${pr[0]?.n ?? 0} slabs${pr[0]?.lo ? ` (#${pr[0].lo}-#${pr[0].hi})` : ""}; MIS logged ${mi[0]?.s ?? 0}${mi[0]?.miss ? ` (${mi[0].miss} hrs without counts)` : ""}; QC ${qc.length ? qc.map((r: any) => `${r.g ?? "ungraded"}:${r.n}`).join(" ") : "none yet"}; JOT ${jt.length ? jt.map((r: any) => `${r.d ?? "no-defect"}:${r.n}`).join(" ") : "none yet"}`);
    }
  } catch { /* best-effort */ }
  // ASKED SLABS: 5-7 digit numbers = slab numbers -> full journey per slab
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const db = prisma as any;
    const slabs = [...new Set(question.match(/\b\d{5,7}\b/g) ?? [])].slice(0, 3).map(Number);
    for (const n of slabs) {
      const [pr, jt, qc, fg]: any[][] = await Promise.all([
        db.$queryRaw`SELECT batch, design_name FROM press WHERE slab_number = ${n} LIMIT 1`,
        db.$queryRaw`SELECT slab_defect, bend_mm, design_name FROM jot WHERE slab_number = ${n} ORDER BY imported_at DESC LIMIT 1`,
        db.$queryRaw`SELECT quality_grade, repolish_status, rw_status FROM polish_qc WHERE slab_number = ${n} ORDER BY imported_at DESC LIMIT 1`,
        db.$queryRaw`SELECT status, bay_number, design FROM fg_finished_slab WHERE slab_number = ${n} LIMIT 1`,
      ]);
      if (!(pr.length || jt.length || qc.length || fg.length)) continue;
      const dsg = pr[0]?.design_name ?? jt[0]?.design_name ?? fg[0]?.design ?? null;
      lines.push(`ASKED SLAB ${n}: design ${dsg ?? "unknown"}; press ${pr[0] ? `batch ${pr[0].batch ?? "?"}` : "no entry"}; JOT ${jt[0] ? (jt[0].slab_defect ?? "no defect") : "no entry"}; QC ${qc[0] ? `${qc[0].quality_grade ?? "ungraded"}${qc[0].repolish_status ? ` ${qc[0].repolish_status}` : ""}` : "no entry"}; stock ${fg[0] ? `${fg[0].status} ${fg[0].bay_number ?? ""}`.trim() : "not in finished goods"}`);
    }
  } catch { /* best-effort */ }
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const db = prisma as any;
    // ASKED DESIGNS: match question words against known design names
    const designs: any[] = await db.$queryRaw`SELECT DISTINCT design FROM fg_finished_slab WHERE design IS NOT NULL ORDER BY design LIMIT 300`;
    const qLower = question.toLowerCase();
    const hits = designs.map((d: any) => String(d.design)).filter((d) => d.length >= 4 && qLower.includes(d.toLowerCase())).slice(0, 2);
    for (const d of hits) {
      const [fg, pr]: any[][] = await Promise.all([
        db.$queryRaw`SELECT status, count(*)::int n FROM fg_finished_slab WHERE design = ${d} GROUP BY 1`,
        db.$queryRaw`SELECT count(DISTINCT slab_number)::int n FROM press WHERE design_name ILIKE ${d} AND imported_at > now() - interval '10 days'`,
      ]);
      lines.push(`ASKED DESIGN ${d}: stock ${fg.map((r: any) => `${r.status}:${r.n}`).join(" ") || "none"}; pressed last 10d: ${pr[0]?.n ?? 0}`);
    }
  } catch { /* best-effort */ }
  return lines.join("\n");
}

export async function aiAnswer(question: string): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return "🤖 Free-text questions aren't switched on yet (no AI key configured). The command reports still work: /status /shift /day /yesterday";
  try {
    const pack = await dataPack(question);
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 400,
        system: "You are the Pacific Surfaces factory ERP assistant answering in a Telegram group. Answer ONLY from the production data provided — never invent numbers. PRESS MACHINE TOTALS are the authoritative slab counts per batch; the LAST ~75min station lines list the individual slabs just entered at Polish QC / press / JOT, and LATEST ENTRY lines give the most recent record per station with its age — use these for any 'last hour / just now / latest / most recent' question; the BY HOUR lines give per-IST-hour counts + slab ranges for today and yesterday — use them for any time-window question; the MIS lines are the manual hourly log and can be incomplete (hours logged without counts). For batch totals ALWAYS use the press totals. When asked about issues/discrepancies, COMPARE press totals against the MIS log: flag batches where MIS logged noticeably fewer slabs than the press made, and hours missing counts. If the question needs data not present here, say exactly what is missing instead of estimating. Be short (2-5 lines), plain text, numbers bold-free. If the data can't answer the question, say so and suggest /status, /shift, /day or the ERP dashboard.",
        messages: [{ role: "user", content: `Production data:\n${pack}\n\nQuestion: ${question.slice(0, 500)}` }],
      }),
    });
    if (!res.ok) { console.error("aiAnswer API", res.status, await res.text().catch(() => "")); return "🤖 Couldn't reach the AI service — try again in a minute."; }
    const j = await res.json();
    const text = (j?.content ?? []).map((c: { text?: string }) => c.text ?? "").join("").trim();
    // Telegram parses our messages as HTML — raw <angle brackets> in the
    // model's prose make it reject the whole message (400 "can't parse entities")
    return text ? esc(text) : "🤖 No answer came back — try rephrasing.";
  } catch (e) {
    console.error("aiAnswer error:", e);
    return "🤖 Something went wrong answering that — the command reports still work.";
  }
}
