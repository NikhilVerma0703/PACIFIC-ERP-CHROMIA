"use server";
// Admin control: re-run the FIFO grit/filler allocator across ALL unlinked
// mixer-cycle demands (heals cycles saved without a silo/buffer once the
// missing name is filled in). Wraps the existing runGritFillerAllocator sweep.
import { isAdmin } from "@/lib/rbac";
import { runGritFillerAllocator } from "@/lib/automations-silo";
import { revalidatePath } from "next/cache";

export async function runAllocatorAction(): Promise<{ ok?: boolean; message: string }> {
  if (!(await isAdmin())) return { message: "Only an administrator can run the allocator." };
  try {
    const r = await runGritFillerAllocator();
    revalidatePath("/live");
    return { ok: true, message: `Allocator done — ${r.fulfilled} demand(s) fulfilled, ${r.unfulfilled} unfulfilled, ${r.silosTouched} silo(s) updated.` };
  } catch (e) {
    return { message: `Allocator failed: ${(e as Error).message}` };
  }
}
