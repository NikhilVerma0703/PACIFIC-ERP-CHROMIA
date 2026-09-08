/**
 * Splitting a mixed batch — the pure part.
 *
 * Batch Number, Design and Target Slabs are NOT per-slab fields: they live on the
 * shared RoboBatchRecipe every slab in a batch points at. So "change the batch for
 * a range of slabs" cannot write a column on those slabs — it re-parents them to a
 * DIFFERENT recipe. That is how two runs recorded as one batch (e.g. 1372 Crystallo
 * and 1404 Bellagio green merged together) get separated: pick the slab where the
 * second batch starts, give it that batch's number/design, and this moves it and
 * every following slab in the run into a recipe for that batch — created if none
 * exists in the shift, joined if one does.
 *
 * Pure and alias-free so `node --test` can reach it. The route owns the Prisma
 * find-or-create and the re-parenting updateMany; this owns the two decisions that
 * must be exactly right: what the target batch's fields are, and whether the
 * target is genuinely a DIFFERENT batch (a real split) or the same one.
 */

export interface BatchFields {
  batchNo: string | null;
  designName: string;
  targetSlabs: number | null;
}

/** One requested change: the new value, and whether its "apply forward" box is
 *  ticked. An unticked (or absent) field keeps the current batch's value. */
export interface FieldChange<T> {
  value: T;
  apply: boolean;
}

export interface BatchChange {
  batchNo?: FieldChange<string | null>;
  designName?: FieldChange<string>;
  targetSlabs?: FieldChange<number | null>;
}

/**
 * The target batch's fields: each is the requested value when its box is ticked,
 * otherwise the current batch's value. So splitting off "1404 / Bellagio green"
 * while leaving Target Slabs unticked keeps the current batch's target on the new
 * recipe, and ticking only Design corrects the design without touching the number.
 */
export function resolveTargetBatch(current: BatchFields, change: BatchChange): BatchFields {
  return {
    batchNo:     change.batchNo?.apply     ? change.batchNo.value     : current.batchNo,
    designName:  change.designName?.apply  ? change.designName.value  : current.designName,
    targetSlabs: change.targetSlabs?.apply ? change.targetSlabs.value : current.targetSlabs,
  };
}

const normNo = (s: string | null | undefined) => (s ?? "").trim();
const normDesign = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/**
 * Whether two batches are the SAME batch — matched on number AND design together,
 * so 1404/Bellagio and 1404/Crystallo are different batches (a reused number is
 * not the same run). Design compares case-insensitively and trimmed, the number
 * trimmed: how the same batch gets typed twice by hand. Target Slabs is NOT part
 * of identity — it is an attribute of the batch, not what names it.
 */
export function sameBatchIdentity(a: BatchFields, b: BatchFields): boolean {
  return normNo(a.batchNo) === normNo(b.batchNo) && normDesign(a.designName) === normDesign(b.designName);
}

/** A real split moves slabs to a DIFFERENT batch (number or design changed). When
 *  identity is unchanged and only Target Slabs differs, nothing moves — that is a
 *  plain attribute edit on the current batch, handled separately. */
export function isReparent(current: BatchFields, target: BatchFields): boolean {
  return !sameBatchIdentity(current, target);
}
