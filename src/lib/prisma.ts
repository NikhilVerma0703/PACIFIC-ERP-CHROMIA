import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// DATABASE_URL_POOLED, when set, is Neon's -pooler endpoint for the same
// database — PgBouncer in front of the compute, so each Vercel lambda reuses a
// pooled connection instead of opening its own to the compute (connection
// churn is billed Neon time, and a busy shift is many small lambdas). It is a
// SEPARATE, additive variable rather than a rewrite of DATABASE_URL because
// the production DATABASE_URL is marked sensitive and cannot be read back:
// overwriting it would leave no way to restore the original if the pooled
// route misbehaved. Absent the variable (local dev, scripts, migrations) the
// client behaves exactly as before. Verified before adoption over the pooler
// with the app's own paths: the daily report, parameterised $queryRawUnsafe,
// an interactive $transaction and a twelve-query burst — identical results.
function createPrisma(): PrismaClient {
  const pooled = process.env.DATABASE_URL_POOLED?.trim();
  return new PrismaClient({
    ...(pooled ? { datasourceUrl: pooled } : {}),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

/** Drop a singleton built before a new model (e.g. FabWorker) was generated.
 *  next dev keeps this module's client on globalThis across HMR, so prisma.fabWorker
 *  stays undefined until the process is restarted — unless we throw the old one away. */
const cached = globalForPrisma.prisma;
if (cached && (cached as { fabWorker?: unknown }).fabWorker === undefined) {
  void cached.$disconnect().catch(() => {});
  globalForPrisma.prisma = undefined;
}

export const prisma = globalForPrisma.prisma ?? createPrisma();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/**
 * THE CLIENT INSIDE AN INTERACTIVE $transaction — and NOT `typeof prisma`.
 *
 * Prisma hands the callback a client with the connection-lifecycle methods
 * removed: you cannot connect, disconnect, extend or nest a transaction from
 * inside one. Its type is therefore `Omit<PrismaClient, "$connect" |
 * "$disconnect" | "$on" | "$transaction" | "$extends">`, which is NARROWER than
 * the client exported above.
 *
 * THREE ROUTES ANNOTATED THAT PARAMETER AS `typeof prisma` — the wider type —
 * and that is what broke `next build`. TypeScript rejected the callback against
 * the interactive overload, fell back to the ARRAY overload of $transaction,
 * and the result came back as `any[]`; every property read off it then failed
 * with "Property 'kind' does not exist on type 'any[]'". Twelve compile errors
 * from one wrong word, not one of them reported near the actual mistake.
 *
 * Derived from `typeof prisma` rather than imported as `Prisma.TransactionClient`
 * so it follows THIS module's client — including the pooled datasource chosen in
 * createPrisma above — and cannot drift when a client version bump reshapes the
 * generated namespace, which is how these errors surfaced in the first place.
 */
export type TxClient = Omit<
  typeof prisma,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends"
>;
