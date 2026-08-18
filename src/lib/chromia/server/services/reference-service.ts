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

  const existing = await prisma.chromiaBaseMaterial.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, code: true },
  });

  const code = toCode(wanted);
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

  const normalised = normaliseFileName(wanted);

  const existing = await prisma.chromiaDesign.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, fileName: true, code: true },
  });

  const code = toCode(wanted);
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

  const existing = await prisma.chromiaRecalibrationReason.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, code: true },
  });

  const code = toCode(wanted);
  const match = existing.find((row) => sameName(row.name, wanted) || row.code === code);
  if (match) return match.id;

  const created = await prisma.chromiaRecalibrationReason.create({
    data: { code, name: wanted },
    select: { id: true },
  });
  return created.id;
}
