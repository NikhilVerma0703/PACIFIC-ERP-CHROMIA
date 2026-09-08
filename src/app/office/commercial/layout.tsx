// The Commercial module's frame. Every page under /office/commercial renders
// inside it, so this is where the direct-render gate lives: middleware already
// stopped the request at the path prefix, and this stops a revoked session
// (middleware runs without the database) and a role that reached a URL by
// typing it. "May do at least one thing here" is the question — each PAGE asks
// for its own action and its own area.
//
// IT ASKS FOR "view" AND THEN FORGIVES A 403, which is not the same as asking
// for nothing. Two logins have no "view":
//
//   the dispatch team, which may only verify (round two, answer 6) and works
//   on /office/commercial/dispatch-check alone;
//
//   and, if the action table ever narrows again, whoever else is admitted to
//   one screen without being admitted to the module's reading.
//
// Gating the frame on the widest single action was the old way of covering
// that, and it broke the day the desk was split: "verify" excludes Raghav
// (COMMERCIAL_DOCS) and Murali (COMMERCIAL_LOGISTICS), so the frame bounced two
// of the four people the module was built for out of every page in it. The
// question the frame can actually answer is "does this login do ANYTHING here",
// and that is `actions.length`.
import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { commercialGate } from "@/lib/commercial/access";

export const dynamic = "force-dynamic";

export default async function CommercialLayout({ children }: { children: React.ReactNode }) {
  const g = await commercialGate("view");
  if (g.status === 401) redirect("/login");
  if (g.actions.length === 0) redirect("/no-access?from=/office/commercial");
  return <Shell>{children}</Shell>;
}
