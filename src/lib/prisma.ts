import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrisma(): PrismaClient {
  return new PrismaClient({
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
