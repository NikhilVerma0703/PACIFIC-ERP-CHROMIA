/**
 * Delay-log reconcile for one slab — what to keep, update and create from the
 * set the client sent back. Pure and alias-free so `node --test` can reach it;
 * the PATCH handler (api/robo/production/[id]/route.ts) does the database work
 * and this decides the shape of it.
 *
 * THE RULE. The payload is the whole delay list as the operator left it. A row
 * WITH an id that is one of THIS slab's rows is updated in place; a row without
 * an id is created; and a row of this slab whose id is absent from the payload
 * was removed on screen, so it is deleted (the caller's deleteMany, scoped to
 * the slab, with keepIds as the exclusion).
 *
 * An id the slab does not own — another slab's delay, or one already removed
 * by a second tab — is treated as a NEW row, not written through. Writing it
 * through would overwrite another slab's delay with this slab's values, and
 * updating a vanished row throws (P2025) and rolls the whole save back. Such an
 * id is also kept OUT of keepIds, so a foreign id in the payload can never
 * shield a row of this slab from deletion.
 */

export interface DelayPayloadItem {
  id?: string | null;
  delayCodeId?: string | null;
  machineId?: string | null;
  machineName?: string | null;
  durationMinutes?: number | string | null;
  startTime?: string | null;
  endTime?: string | null;
  remarks?: string | null;
}

export interface DelayFields {
  machineId: string | null;
  machineName: string | null;
  delayCodeId: string;
  durationMinutes: number;
  startTime: string | null;
  endTime: string | null;
  remarks: string | null;
}

export interface DelayReconcilePlan {
  /** Ids of this slab's rows the payload still carries — everything else of the slab is deleted. */
  keepIds: string[];
  updates: Array<{ id: string; fields: DelayFields }>;
  creates: DelayFields[];
}

export function delayFieldsOf(d: DelayPayloadItem): DelayFields {
  return {
    machineId:       d.machineId || null,
    machineName:     d.machineName || null,
    delayCodeId:     String(d.delayCodeId),
    durationMinutes: Number(d.durationMinutes) || 0,
    startTime:       d.startTime || null,
    endTime:         d.endTime || null,
    remarks:         d.remarks || null,
  };
}

/**
 * `ownedIds` is the set of delay ids that belong to the slab being edited, read
 * inside the same transaction so the plan reflects the rows that actually exist.
 *
 * A row with no delay code is an empty line the operator never filled — never
 * written (not updated, not created as a blank). An owned id on such a row is
 * still kept, as it always was: clearing the code on screen is not removing
 * the row.
 */
export function planDelayReconcile(
  items: readonly DelayPayloadItem[],
  ownedIds: Iterable<string>,
): DelayReconcilePlan {
  const owned = new Set(ownedIds);
  const plan: DelayReconcilePlan = { keepIds: [], updates: [], creates: [] };

  for (const d of items) {
    const id = typeof d.id === "string" && d.id.length > 0 && owned.has(d.id) ? d.id : null;
    if (id) plan.keepIds.push(id);
    if (!d.delayCodeId) continue;
    const fields = delayFieldsOf(d);
    if (id) plan.updates.push({ id, fields });
    else plan.creates.push(fields);
  }
  return plan;
}
