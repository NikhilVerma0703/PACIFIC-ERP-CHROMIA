// The Commercial module's frame. Every page under /office/commercial renders
// inside it, so this is where the direct-render gate lives: middleware already
// stopped the request at the path prefix, and this stops a revoked session
// (middleware runs without the database) and a role that reached a URL by
// typing it. "May do at least one thing here" is the question — the dispatch
// team may only verify, and lands on its own page, so the layout cannot ask
// for "view"; each PAGE asks for its own action.
import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { commercialGate } from "@/lib/commercial/access";
import { commercialActionsFor } from "@/lib/commercial/access-rules";

export const dynamic = "force-dynamic";

export default async function CommercialLayout({ children }: { children: React.ReactNode }) {
  const g = await commercialGate("verify");            // the widest action; everyone in the module has it
  if (!g.ok || commercialActionsFor(g.user).length === 0) {
    redirect(g.status === 401 ? "/login" : "/no-access?from=/office/commercial");
  }
  return <Shell>{children}</Shell>;
}
