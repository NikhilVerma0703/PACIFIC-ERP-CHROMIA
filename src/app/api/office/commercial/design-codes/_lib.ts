// Shared by the design-code handlers. Not a route.
import { prisma } from "@/lib/prisma";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db = prisma as any;

/** Prisma's unique-violation code: two designs cannot share one item code. */
export function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";
}
