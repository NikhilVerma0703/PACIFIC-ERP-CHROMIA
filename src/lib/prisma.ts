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
