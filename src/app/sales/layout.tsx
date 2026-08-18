// International Sales lives inside the main ERP Shell (Nav's "International
// Sales" section was wired in P2; the middleware already confines non-admin
// sales staff to /sales and keeps every other department out). This gate is
// the server-side backstop: salesGate revalidates the session against the DB
// and checks membership (branch INTERNATIONAL_SALES, or ADMIN).
import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { salesGate } from "@/lib/sales/access";

export default async function SalesLayout({ children }: { children: React.ReactNode }) {
  const gate = await salesGate();
  if (!gate.ok) redirect(gate.status === 401 ? "/login" : "/");
  return <Shell>{children}</Shell>;
}
