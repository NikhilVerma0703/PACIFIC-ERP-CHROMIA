/**
 * Chromia's database handle.
 *
 * The standalone module owned its own Prisma client (Prisma 7 + a node-postgres
 * driver adapter). Inside the ERP there is exactly one client for the whole
 * app — `src/lib/prisma.ts` — and every module shares it, the same way the Robo
 * module does. This file exists so the ported module code can keep importing
 * `@/lib/chromia/db` unchanged: it is the one seam where "the module's database"
 * becomes "the ERP's database".
 */
export { prisma } from "@/lib/prisma";
export type { PrismaClient } from "@prisma/client";
