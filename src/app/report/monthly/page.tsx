import { redirect } from "next/navigation";

// The monthly report lives INSIDE the CEO report now (its Monthly toggle) —
// this route survives only so old links and bookmarks keep working.
export default async function MonthlyReportRedirect({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { m } = await searchParams;
  redirect(m && /^\d{4}-\d{2}$/.test(m) ? `/report/ceo?m=${m}` : "/report/ceo?view=monthly");
}
