"use client";
// A document's number with its date DIRECTLY UNDER it (answer 6), the one way
// the invoice register, the challan book, the order's Invoice tab and the two
// detail headers all print the pair — so a reader finds the date in the same
// place on every screen, as they do on every printed page. The optional tag
// is the financial year the register shows beside a CONTINUOUS export number
// (PESPL/N{seq} runs on across years, so the number alone no longer says
// which year's books it sits in).
import Link from "next/link";
import { Badge } from "@/components/ui";
import { dmy } from "./ui";

export function DocNumber({ number, date, href, tag, size = "sm" }: {
  number: string;
  date: string | null | undefined;
  /** Link the number when the row is not already the document's own page. */
  href?: string;
  tag?: string | null;
  size?: "sm" | "lg";
}) {
  const numberClass = size === "lg" ? "text-xl font-semibold text-gray-900" : "font-medium";
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {href
          ? <Link href={href} className={`${numberClass} text-brand hover:underline`}>{number}</Link>
          : <span className={numberClass}>{number}</span>}
        {tag && <Badge>{tag}</Badge>}
      </div>
      <div className={size === "lg" ? "text-sm text-gray-500" : "text-xs text-gray-500"}>{dmy(date)}</div>
    </div>
  );
}
