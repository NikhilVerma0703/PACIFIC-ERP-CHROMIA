import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { chromiaGate, CHROMIA_MIN_TIER } from "@/lib/chromia/access";
import { referenceData } from "@/lib/chromia/store";
import { IntakeForm } from "./IntakeForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Receive slabs | Pacific ERP" };

/**
 * Slab intake. Reached from the register, not from the menu.
 *
 * That is the module's own decision, kept: "the form is not a place you visit;
 * it is what opens when you click a slab that still needs finishing. Leaving it
 * in the menu invited someone to open a blank one and type a slab the operator
 * had already entered."
 */
export default async function ChromiaSlabIntakePage() {
  const gate = await chromiaGate(CHROMIA_MIN_TIER.production);
  if (!gate.ok) redirect("/");

  const refs = await referenceData();

  return (
    <Shell>
      <div className="mb-6">
        <Link href="/chromia/slabs" className="text-sm text-gray-400 hover:text-brand">
          ← All slabs
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-gray-900">Receive slabs</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          A slab is created once, here, and keeps its number for the rest of its life — through
          every pass and every recalibration.
        </p>
      </div>
      <IntakeForm designs={refs.designs} locations={refs.locations} />
    </Shell>
  );
}
