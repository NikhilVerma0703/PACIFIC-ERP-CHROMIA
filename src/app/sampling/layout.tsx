import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { samplingGate } from "@/lib/sampling/access";

/**
 * Sampling module shell.
 *
 * Chrome comes from the ERP's own <Shell> — sidebar, user card, sign-out — the
 * way Robo and Chromia do it. There is no tab strip inside the page: the
 * sidebar's Sampling section already lists all three screens (see Nav.tsx), and
 * a second copy of the same menu above every page is what the Chromia layout
 * removed for exactly this reason.
 *
 * THE GATE IS HERE rather than in each of the three pages: middleware stops a
 * request at the path prefix, this stops a direct render, and each is useless on
 * its own the day the other is edited. Every /api/sampling route carries its
 * own.
 *
 * IT ASKS FOR "view", WHICH IS THE NARROWEST THING THESE PAGES DO — and asking
 * for it by name is what keeps the Fabrication Supervisor out. He may add sample
 * stock and nothing else (lib/sampling/actions.ts), so the inventory and the
 * dispatch board are not his; his own controls live on /fab/supervisor/slabs and
 * talk to the API. Middleware already refuses him these paths a few blocks down,
 * in his FABRICATION branch block; this is the second lock on the same door.
 *
 * A REFUSAL GOES TO /no-access, NOT TO "/". Role.SAMPLING's cap excludes "/", so
 * sending a refused sampling login there would be answered by denied() ->
 * homeFor("SAMPLING") -> "/sampling" -> this layout again: the infinite redirect
 * role CHROMIA shipped once (see the note in lib/routeCaps.ts homeFor). The
 * refusal page is public in middleware and reachable by every capped role.
 */
export default async function SamplingLayout({ children }: { children: React.ReactNode }) {
  const gate = await samplingGate("view");
  if (!gate.ok) redirect(gate.status === 401 ? "/login" : "/no-access?from=/sampling");

  return <Shell>{children}</Shell>;
}
