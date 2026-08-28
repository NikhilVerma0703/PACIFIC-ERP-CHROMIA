import { prisma } from '@/lib/chromia/db';
import { ValidationError } from '@/lib/chromia/errors';
import { normaliseFileName } from '@/lib/chromia/operator-register';

/**
 * Reference data that can be typed as well as picked.
 *
 * Base materials, design files and recalibration reasons all behave the same
 * way on the shop floor: there is a known list, and every so often something
 * new turns up that nobody has set up yet. Forcing the in-charge to leave the
 * form, create the record and come back is how registers end up with the wrong
 * material picked "for now".
 *
 * So each of these resolvers takes what the user typed, matches it against
 * what already exists — ignoring case and spacing, because "Roller mark" and
 * "ROLLER MARK" are the same thing — and creates the record only when it is
 * genuinely new. Nothing is ever duplicated by a difference in typing.
 *
 * ── PERFORMANCE ──────────────────────────────────────────────────────────
 * The loose match cannot be expressed in SQL, so the fallback loads the list
 * and compares in memory. That list grows every time an import invents a design
 * from a file name, and it was being read in full on every single save — the
 * biggest, most-typed one, the operator entry, does two of these. Each resolver
 * now tries the stable `code` first, which is unique and indexed and is what a
 * name picked from the list resolves to, so the common save never scans the
 * table. The scan stays as the exact same fallback for a genuinely new or
 * oddly-punctuated name, so the answer is unchanged — only the work is less.
 */

/** Slug a free-text name into a stable business code. */
function toCode(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

/** Loose comparison — case and spacing are typing, not meaning. */
function sameName(a: string, b: string): boolean {
  const flatten = (value: string) => value.trim().toUpperCase().replace(/\s+/g, ' ');
  return flatten(a) === flatten(b);
}

export async function resolveBaseMaterialId(name: string): Promise<string> {
  const wanted = name.trim();
  if (!wanted) throw new ValidationError('Enter a base material / slab name');

  const code = toCode(wanted);

  // The common path: the name maps to a code already on file — an indexed
  // lookup, not a scan of every material. The full scan matches `code` too, so
  // this returns exactly what it would; it only skips the read.
  const byCode = await prisma.chromiaBaseMaterial.findFirst({
    where: { code, deletedAt: null },
    select: { id: true },
  });
  if (byCode) return byCode.id;

  const existing = await prisma.chromiaBaseMaterial.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, code: true },
  });

  const match = existing.find((row) => sameName(row.name, wanted) || row.code === code);
  if (match) return match.id;

  const created = await prisma.chromiaBaseMaterial.create({
    data: { code, name: wanted },
    select: { id: true },
  });
  return created.id;
}

/**
 * Match a design on its file name or its display name.
 *
 * The register writes the file name; the seed data carries both. Either is a
 * valid way to name the same design, so both are searched before anything new
 * is created.
 */
export async function resolveDesignId(fileName: string): Promise<string> {
  const wanted = fileName.trim();
  if (!wanted) throw new ValidationError('Enter a file name / planned design');

  const code = toCode(wanted);

  // Fast path on the unique code, as for base materials — a file name picked
  // from the list resolves to a code that already exists and returns at once,
  // rather than reading every design on file (imports mint one per file name,
  // so this list is the one that grows without bound).
  const byCode = await prisma.chromiaDesign.findFirst({
    where: { code, deletedAt: null },
    select: { id: true },
  });
  if (byCode) return byCode.id;

  const normalised = normaliseFileName(wanted);

  const existing = await prisma.chromiaDesign.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, fileName: true, code: true },
  });

  const match = existing.find(
    (row) =>
      sameName(row.name, wanted) ||
      sameName(row.fileName, wanted) ||
      normaliseFileName(row.fileName) === normalised ||
      row.code === code,
  );
  if (match) return match.id;

  const created = await prisma.chromiaDesign.create({
    data: { code, name: wanted, fileName: wanted },
    select: { id: true },
  });
  return created.id;
}

export async function resolveRecalibrationReasonId(name: string): Promise<string> {
  const wanted = name.trim();
  if (!wanted) throw new ValidationError('Enter a recalibrate reason');

  const code = toCode(wanted);

  const byCode = await prisma.chromiaRecalibrationReason.findFirst({
    where: { code, deletedAt: null },
    select: { id: true },
  });
  if (byCode) return byCode.id;

  const existing = await prisma.chromiaRecalibrationReason.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, code: true },
  });

  const match = existing.find((row) => sameName(row.name, wanted) || row.code === code);
  if (match) return match.id;

  const created = await prisma.chromiaRecalibrationReason.create({
    data: { code, name: wanted },
    select: { id: true },
  });
  return created.id;
}
