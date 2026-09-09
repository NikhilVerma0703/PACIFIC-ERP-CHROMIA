// GET  /api/office/commercial/orders/[id]/tasks — the order's task list, its
//      defaults seeded on the first read
// POST /api/office/commercial/orders/[id]/tasks — { label, note?, status? }
//      add a line the default list does not have
//
// Round three, answers 7 and 8. The owner's words were "however much we can
// incorporate; we will build on it at last" and "for now if we cannot add
// anything we'll add a tickbox, or if we can add more then we'll add more" —
// so container booking, CHA, the BL draft, COO, CEFA, fumigation, TiO2, the
// RFID lock, container pictures, the shipping documents, the Daltile upload
// and the ETA sheet become a tick with a date and a note, and the module does
// not pretend to do the work. The three domestic lines are the same idea for a
// truck: transport booking, transporter bills, the e-way bill.
//
// AREA "checklist", not "orders", and the review is why. Nine of the twelve
// export lines are Raghav's own work — the BL draft, COO, CEFA, TiO2, the
// portal uploads — and COMMERCIAL_DOCS holds `orders: view` with
// `checklist: write` (access-rules.ts, whose comment for that row reads "He
// fills the checklist on an order he does not otherwise edit"). Gated on
// "orders" he was shown the card fully enabled and every tick came back 403.
// access-rules.SEGMENT_AREA maps `tasks` to `checklist` too, so middleware,
// this gate and the card now answer the same question the same way — and the
// card's mayWrite (actions.includes("write")) names exactly the set of logins
// that hold checklist: write, which tests/commercialOrders.test.ts pins.
import { commercialGate, actorStamp } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain, paramId, str } from "@/lib/commercial/http";
import { logOrderEvent } from "@/lib/commercial/events";
import {
  tasksToSeed, taskProgress, progressNote, sortTasks, nextSortOrder, taskKeyFor, isTaskStatus, doneAtFor,
  type TaskLike, type TaskStatus,
} from "@/lib/commercial/tasks-rules";
import { db, loadOrderWithItems } from "../../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/**
 * The order's tasks, seeding whichever defaults for its kind are MISSING.
 *
 * SEEDED ON READ, and on a "view" gate. Every other route in the module writes
 * only behind "write", and this is the one deliberate exception: the list has
 * to exist before anybody can tick anything, an order created before this
 * shipped has none, and asking a clerk to press "create the checklist" before
 * using the checklist is a step that exists only because of how the code is
 * arranged. Nothing here is user data — it is the same rows for every order of
 * that kind.
 *
 * BY MISSING KEY, NOT BY A ROW COUNT. `kind` is editable after creation, so an
 * order created DOMESTIC and opened once (three truck ticks seeded) and then
 * corrected to EXPORT would have kept the wrong list for ever under a count
 * guard — there is no re-seed button, and taskKeyFor refuses the default keys
 * to a hand-typed line, so the export rows could never arrive at all. See
 * tasks-rules.tasksToSeed for why the other kind's rows are left alone.
 *
 * createMany with skipDuplicates, so two tabs opening the same order at once
 * seed it once: the unique index (orderId, taskKey) is the real guard.
 */
async function loadTasks(orderId: string, kind: string): Promise<TaskLike[]> {
  const existing: Array<{ taskKey: string }> = await db.commercialOrderTask.findMany({ where: { orderId }, select: { taskKey: true } });
  const rows = tasksToSeed(kind, existing.map((t) => String(t.taskKey)))
    .map((t) => ({ orderId, taskKey: t.key, label: t.label, sortOrder: t.sortOrder }));
  if (rows.length) await db.commercialOrderTask.createMany({ data: rows, skipDuplicates: true });
  return db.commercialOrderTask.findMany({ where: { orderId }, orderBy: [{ sortOrder: "asc" }, { label: "asc" }] });
}

/** The one answer shape both handlers return, so the card never has to work
 *  out the counts a second time and disagree with the server about them. */
function answer(tasks: TaskLike[], viewerName: string | null) {
  const sorted = sortTasks(tasks);
  const progress = taskProgress(sorted);
  return plain({ tasks: sorted, progress, progressNote: progressNote(progress), viewer: { name: viewerName } });
}

export async function GET(_req: Request, { params }: Ctx) {
  const g = await commercialGate("view", "checklist");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const id = await paramId(params);
    const order = await loadOrderWithItems(id);
    const tasks = await loadTasks(id, String(order.kind ?? ""));
    return json(answer(tasks, actorStamp(g.user).name));
  });
}

interface PostBody { label?: unknown; note?: unknown; status?: unknown }

export async function POST(req: Request, { params }: Ctx) {
  const g = await commercialGate("write", "checklist");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const id = await paramId(params);
    const order = await loadOrderWithItems(id);
    const body = await readBody<PostBody>(req);
    const label = str(body.label);
    if (!label) fail(400, "Give the task a name");
    const raw = str(body.status)?.toUpperCase() ?? "PENDING";
    if (!isTaskStatus(raw)) fail(400, "status must be PENDING, DONE or NOT_REQUIRED");
    const status = raw as TaskStatus;

    // Seeded first: a task added to an order nobody had opened yet must not be
    // the only row on it, and the defaults must not arrive afterwards and sit
    // above it in the list.
    const tasks = await loadTasks(id, String(order.kind ?? ""));
    if (tasks.some((t) => t.label.trim().toLowerCase() === label.toLowerCase())) {
      fail(409, `"${label}" is already on this order's task list`);
    }
    const stamp = actorStamp(g.user);
    const now = new Date();
    await db.commercialOrderTask.create({
      data: {
        orderId: id,
        taskKey: taskKeyFor(label, tasks.map((t) => t.taskKey)),
        label,
        status,
        note: str(body.note),
        sortOrder: nextSortOrder(tasks),
        doneAt: doneAtFor(status, now),
        doneById: status === "PENDING" ? null : stamp.id,
        doneByName: status === "PENDING" ? null : stamp.name,
      },
    });
    // "task_changed", not "checklist": the 22-point SOP sheet on the Overview
    // tab is what "checklist" means in the log, and the Log tab filters the
    // two apart.
    await logOrderEvent(id, "task_changed", {
      note: `Task added: "${label}"`,
      by: g.user,
      payload: { tasks: true, added: label, status },
    });
    const after = await db.commercialOrderTask.findMany({ where: { orderId: id }, orderBy: [{ sortOrder: "asc" }, { label: "asc" }] });
    return json(answer(after, stamp.name), 201);
  });
}
