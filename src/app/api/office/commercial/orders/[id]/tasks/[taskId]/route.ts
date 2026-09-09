// PATCH /api/office/commercial/orders/[id]/tasks/[taskId]
//   { status?, note?, doneAt? } — the tick, the date and the note of round
//   three, answers 7 and 8. Any one of them, or all three.
//
// The doer's NAME is stamped by the server from the session, never taken from
// the body: "who ticked the BL draft" is the only part of this row anybody
// will argue about later, and a field the client sets is not evidence. For the
// same reason a PATCH that carried no `status` no longer writes a log line
// saying the row was ticked — see taskEditNote.
//
// AREA "checklist" (see the list route's header): most of this list is
// COMMERCIAL_DOCS's own work and that login holds `orders: view`, so gating
// the tick on "orders" refused the desk the list belongs to.
import { commercialGate, actorStamp } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain, str, dateOnly } from "@/lib/commercial/http";
import { logOrderEvent } from "@/lib/commercial/events";
import {
  taskProgress, progressNote, sortTasks, isTaskStatus, doneAtFor, taskEventNote, taskEditNote, changedTaskFields,
  type TaskLike, type TaskStatus,
} from "@/lib/commercial/tasks-rules";
import { db } from "../../../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string; taskId: string }> };

interface Body { status?: unknown; note?: unknown; doneAt?: unknown }

const has = (b: Record<string, unknown>, k: string): boolean => Object.prototype.hasOwnProperty.call(b, k);

export async function PATCH(req: Request, { params }: Ctx) {
  const g = await commercialGate("write", "checklist");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const { id, taskId } = await params;
    if (!id || !taskId) fail(400, "Missing id");
    // Read by id AND check the order: a task must not be reachable through
    // another order's URL, and the row is needed anyway for the log line and
    // for the date an already-done task keeps.
    const row = await db.commercialOrderTask.findUnique({ where: { id: taskId } });
    if (!row || row.orderId !== id) fail(404, "Task not found on this order");

    const body = await readBody<Body>(req);
    const data: Record<string, unknown> = {};
    const now = new Date();
    const stamp = actorStamp(g.user);
    let status = String(row.status) as TaskStatus;
    // Whether the TICK was part of this request decides what the log says
    // below. A note typed on a row somebody else ticked is not a tick.
    const statusSent = has(body as Record<string, unknown>, "status");

    if (statusSent) {
      const raw = str(body.status)?.toUpperCase();
      if (!raw || !isTaskStatus(raw)) fail(400, "status must be PENDING, DONE or NOT_REQUIRED");
      status = raw;
      data.status = status;
      // The date follows the status (tasks-rules.doneAtFor): un-ticking clears
      // it, so a line that is open again does not still carry the day somebody
      // ticked it by mistake. An already-DONE task keeps its original date.
      data.doneAt = doneAtFor(status, now, row.doneAt ?? null);
      // Who is answerable for the line as it now stands. PENDING has no doer.
      data.doneById = status === "PENDING" ? null : stamp.id;
      data.doneByName = status === "PENDING" ? null : stamp.name;
    }
    // An explicit date wins over the stamp — the BL draft was sent on Friday
    // and ticked on Monday, and the sheet the customer sees is Friday's.
    if (has(body as Record<string, unknown>, "doneAt")) {
      const raw = str(body.doneAt);
      const d = dateOnly(raw);
      if (raw && !d) fail(400, "The date must be YYYY-MM-DD");
      // AN EMPTY DATE SENT ON PURPOSE CLEARS IT, even on a done task. It used
      // to fall back to `doneAtFor("DONE", now, row.doneAt)`, which put the
      // stored date straight back: a clerk who cleared a wrong completion date
      // got no error, no change and a log line saying something had happened.
      // A ticked line with no date says "done, day unknown", which is what the
      // clerk just told us; the date box is theirs to refill.
      if (status === "DONE") data.doneAt = d;
      else if (!raw) data.doneAt = null;
      else fail(400, "Only a task marked done carries a date");
    }
    if (has(body as Record<string, unknown>, "note")) data.note = str(body.note);
    if (Object.keys(data).length === 0) fail(400, "Nothing to change: send status, doneAt or note");

    // A PATCH that changes nothing writes nothing. Blurring an untouched note
    // box, or clearing a date that is already blank, would otherwise leave a
    // log line asserting an edit that never happened — and the log is the only
    // record this list keeps.
    const changed = changedTaskFields(row as unknown as Record<string, unknown>, data);
    if (changed.length === 0) return json(await answerFor(id, stamp.name));

    await db.commercialOrderTask.update({ where: { id: taskId }, data });

    // Answer 7 again: the tick, the date and the note are the whole record, so
    // the log carries all three — a tick with no trace of who or when is not
    // worth having. But only a request that CARRIED the tick may word itself
    // as one: `status` defaults to the row's current value, so the old
    // unconditional taskEventNote credited Setumani's tick to whoever typed
    // the courier reference into the note box a day later.
    // What the row now HOLDS, which is not `data.x ?? row.x`: a cleared note
    // and a cleared date are null in `data`, and ?? would have put the old
    // value back into the log line describing the clear.
    const noteNow = has(data, "note") ? (data.note as string | null) : (row.note ?? null);
    const doneAtNow = has(data, "doneAt") ? (data.doneAt as Date | null) : (row.doneAt ?? null);
    await logOrderEvent(id, "task_changed", {
      note: statusSent
        ? taskEventNote(String(row.label), status, stamp.name, noteNow)
        : taskEditNote(String(row.label), stamp.name, { note: changed.includes("note"), date: changed.includes("doneAt") }, noteNow),
      by: g.user,
      payload: { tasks: true, taskKey: row.taskKey, label: row.label, status, statusChanged: statusSent, doneAt: doneAtNow, note: noteNow },
    });

    return json(await answerFor(id, stamp.name));
  });
}

/** The one answer shape this route returns — the same one the list route
 *  sends, so the card never has to work the counts out itself. */
async function answerFor(orderId: string, viewerName: string | null) {
  const after: TaskLike[] = await db.commercialOrderTask.findMany({ where: { orderId }, orderBy: [{ sortOrder: "asc" }, { label: "asc" }] });
  const sorted = sortTasks(after);
  const progress = taskProgress(sorted);
  return plain({ tasks: sorted, progress, progressNote: progressNote(progress), viewer: { name: viewerName } });
}
