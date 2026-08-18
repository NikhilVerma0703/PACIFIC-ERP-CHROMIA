"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { isAdmin, currentUser } from "@/lib/rbac";
import type { ShiftLetter } from "@/lib/shiftScore";

/**
 * Award a set of contested slabs to one shift — or hand them back to nobody.
 *
 * ADMIN ONLY, and the check is here rather than only in the page: this writes
 * the row the payout is calculated from, so a server action reachable by POST
 * must gate itself. Middleware covers /scoreboard, but an action is its own
 * endpoint.
 *
 * Left alone, a slab two shifts both claimed scores for neither — correct, since
 * paying it twice is wrong and nothing in the data says whose it was. A person
 * does know, and this is where they say so.
 */
export async function awardDisputedSlabs(_prev: string | undefined, fd: FormData): Promise<string> {
  if (!(await isAdmin())) return "Only an administrator can award a disputed slab.";

  const winner = String(fd.get("winner") ?? "").trim();
  const slabs = String(fd.get("slabs") ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!slabs.length) return "No slabs to award.";
  if (slabs.length > 2000) return "Too many slabs in one ruling — correct the MIS range instead.";

  const me = await currentUser();
  const by = me?.name || me?.email || "admin";

  // "" means UNDO: clear the ruling and let both shifts lose the slabs again.
  if (!winner) {
    try {
      await (prisma as { slabClaimAward: { deleteMany: (a: unknown) => Promise<unknown> } })
        .slabClaimAward.deleteMany({ where: { slabNumber: { in: slabs } } });
    } catch (e) {
      return `Could not clear the ruling: ${e instanceof Error ? e.message : String(e)}`;
    }
    revalidatePath("/scoreboard");
    return "ok";
  }

  // "<YYYY-MM-DD><A|B|C>" — the shift instance, exactly as the board keys it.
  const anchor = winner.slice(0, 10);
  const shift = winner.slice(10) as ShiftLetter;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor) || !["A", "B", "C"].includes(shift)) {
    return "That is not a valid shift.";
  }

  try {
    const db = prisma as unknown as {
      slabClaimAward: {
        deleteMany: (a: unknown) => Promise<unknown>;
        createMany: (a: unknown) => Promise<unknown>;
      };
    };
    // Replace rather than upsert-per-slab: one ruling supersedes the last, and a
    // delete+insert is a single decision rather than N racing writes.
    await prisma.$transaction([
      db.slabClaimAward.deleteMany({ where: { slabNumber: { in: slabs } } }),
      db.slabClaimAward.createMany({
        data: slabs.map((slabNumber) => ({ slabNumber, anchor, shift, decidedBy: by })),
        skipDuplicates: true,
      }),
    ] as never);
  } catch (e) {
    return `Could not save the ruling: ${e instanceof Error ? e.message : String(e)}`;
  }

  revalidatePath("/scoreboard");
  return "ok";
}
