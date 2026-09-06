// GET   /api/office/commercial/settings/sequences — every document counter.
// PATCH /api/office/commercial/settings/sequences — set one counter's next value.
//
// A counter is the next number a document of that kind will take. Every one
// starts at 1, because who owns the numbering — Tally or the ERP — is still
// open (OPEN-QUESTIONS §4, §8). Before the first live document an admin sets
// each counter to the number after the last one Tally issued.
//
// LOWERING a counter is the dangerous direction: it hands out numbers already
// printed on documents a customer holds, and the document tables' uniqueness
// constraints will then refuse the save at the worst moment. So a decrease is
// refused with 409 and takes an explicit { force: true } — the screen turns
// that into a second, deliberate click.
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, handle, readBody, plain, str } from "@/lib/commercial/http";
import { setNext } from "@/lib/commercial/sequence";
import { sequenceChange, pageArgs, previewCounters } from "@/lib/commercial/settings-rules";
import { DEFAULT_SETTINGS, mergeSettings } from "@/lib/commercial/settings-defaults";
import { loadOverrides } from "@/lib/commercial/settings";
import { db, settingsView, loadSequences, currentNext, type SequenceRow } from "../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const g = await commercialGate("admin");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const u = new URL(req.url);
    const q = str(u.searchParams.get("q"))?.toLowerCase() ?? null;
    const { page, limit, skip, take } = pageArgs(u.searchParams.get("page"), u.searchParams.get("limit"));
    const all = await loadSequences();
    const rows = q ? all.filter((r) => r.key.toLowerCase().includes(q)) : all;
    const view = await settingsView(undefined, all);
    return json(plain({
      items: rows.slice(skip, skip + take),
      total: rows.length, page, limit,
      previews: view.previews,
      numbering: view.merged.numbering,
    }));
  });
}

export async function PATCH(req: Request) {
  const g = await commercialGate("admin");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const body = await readBody<{ key?: unknown; nextValue?: unknown; force?: unknown }>(req);
    const key = str(body.key);
    const decision = sequenceChange({ key, nextValue: body.nextValue, current: key ? await currentNext(key) : null, force: body.force });
    if (!decision.ok) {
      // 409 is "confirm and send it again with force"; the screen shows the
      // message and a second button rather than a dead end.
      return json({ error: decision.message, needsForce: decision.status === 409 }, decision.status);
    }
    await setNext(decision.key, decision.value);
    // commercial_sequence.updated_at is @default(now()) with no @updatedAt, and
    // setNext's upsert does not set it — only takeSequence's raw SQL does. So a
    // counter aligned by hand would keep showing the date it was first used,
    // which is exactly the column this screen is read for. Stamp it here.
    await db.commercialSequence.update({ where: { key: decision.key }, data: { updatedAt: new Date() } }).catch(() => undefined);
    const sequences = await loadSequences();
    const settings = mergeSettings(DEFAULT_SETTINGS, await loadOverrides());
    const row = sequences.find((r) => r.key === decision.key) ?? ({ key: decision.key, nextValue: decision.value, updatedAt: new Date() } as SequenceRow);
    return json(plain({ sequence: row, sequences, previews: previewCounters(settings, sequences, new Date()) }));
  });
}
