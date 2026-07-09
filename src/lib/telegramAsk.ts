// Free-text questions from the Telegram group ("/ask how many slabs did we
// lose to downtime this week?"). We do NOT let the model touch the DB — we
// hand it a compact pack of live production numbers and it answers from that.
// Needs ANTHROPIC_API_KEY in env; soft-fails with a friendly message without it.
import { getDowntimeReport } from "@/lib/downtime";
import { getLastShiftReport } from "@/lib/misShift";
import { ymdIST, plusDay, lastCompletedHourIST, hourlyMessage } from "@/lib/telegramReports";

async function dataPack(): Promise<string> {
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
  return lines.join("\n");
}

export async function aiAnswer(question: string): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return "🤖 Free-text questions aren't switched on yet (no AI key configured). The command reports still work: /status /shift /day /yesterday";
  try {
    const pack = await dataPack();
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 400,
        system: "You are the Pacific Surfaces factory ERP assistant answering in a Telegram group. Answer ONLY from the production data provided — never invent numbers. Be short (2-5 lines), plain text, numbers bold-free. If the data can't answer the question, say so and suggest /status, /shift, /day or the ERP dashboard.",
        messages: [{ role: "user", content: `Production data:\n${pack}\n\nQuestion: ${question.slice(0, 500)}` }],
      }),
    });
    if (!res.ok) { console.error("aiAnswer API", res.status, await res.text().catch(() => "")); return "🤖 Couldn't reach the AI service — try again in a minute."; }
    const j = await res.json();
    const text = (j?.content ?? []).map((c: { text?: string }) => c.text ?? "").join("").trim();
    return text || "🤖 No answer came back — try rephrasing.";
  } catch (e) {
    console.error("aiAnswer error:", e);
    return "🤖 Something went wrong answering that — the command reports still work.";
  }
}
