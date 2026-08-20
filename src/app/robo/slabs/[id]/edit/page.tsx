import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Shell } from "@/components/Shell";
import { Card } from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { canEditRoboSetup } from "@/lib/rbac";
import { RoboEntryForm } from "@/components/robo/RoboEntryForm";
import { plantDate, setupDate } from "@/lib/robo/setupAge";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Edit Slab | Pacific ERP" };

/**
 * Correct one slab record, from any shift — INCLUDING shifts that are already
 * closed. That is the point of the page: the robo entry form only ever reaches
 * the active shift, so before this existed a slab logged wrong could not be
 * corrected at all once its shift rolled over, and the only remedy would have
 * been to delete and re-enter it.
 *
 * TWO THINGS CAN BE WRONG about a slab, and they live in different rows:
 *
 *   Slab   — its own numbers. S.No., slab number, In/Out times, Roymix body
 *            weight and cycle time, remarks, delays. One row, one slab.
 *   Setup  — the run it was logged under. Design, thickness, batch no., target
 *            slabs, and which robots ran with which program, tool, liquid,
 *            powder and target cycle time. ONE ROW SHARED BY THE WHOLE BATCH.
 *
 * Only the first was reachable here. The setup could be corrected solely from
 * the entry screen's "Edit setup" button, which reaches the run the active
 * shift is on and nothing else — so a batch saved against the wrong design was
 * permanently wrong from the next morning onwards, on every slab in it.
 *
 * So this page is now two tabs over the same slab, `?section=slab` (the
 * default, unchanged) and `?section=setup`. Both mount the same RoboEntryForm
 * the operator fills in, in the matching mode, so the fields, the comboboxes
 * and the validation behave identically; only the way in is different.
 *
 * There is no age cutoff on either. A slab logged under the wrong design in
 * May is still wrong in August, and refusing the correction only keeps the
 * register wrong — what age changes is how loudly the screen says who else is
 * affected, which is setupAge.ts's job. See its header.
 */
export default async function EditRoboSlabPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ section?: string }>;
}) {
  const { id } = await params;
  const { section } = await searchParams;
  const wantsSetup = section === "setup";

  // Resolved here rather than in the client so a missing slab is a real 404
  // page, and so the heading is right on first paint instead of after a fetch.
  const record = await prisma.roboProductionRecord.findUnique({
    where: { id },
    select: {
      slabNumber: true,
      batchRecipeId: true,
      shift: { select: { shiftNumber: true, date: true, status: true } },
      batchRecipe: {
        select: {
          id: true, productionDate: true, batchNo: true, designName: true,
          thickness: true, targetSlabs: true, notes: true,
          entries: {
            select: {
              machine: { select: { name: true } },
              programName: true, toolName: true, liquidName: true,
              powderName: true, rollerHeight: true, targetCycleTime: true,
            },
          },
        },
      },
    },
  });
  if (!record) notFound();

  const setup = record.batchRecipe;

  // Gated here as well as in the PATCH handler, so a ROBO operator who may not
  // change a setup is never shown the tab rather than meeting a 403 after
  // filling it in. canEditRoboSetup() admits the tablet role itself — see
  // src/lib/rbac.ts for why it is wider than the slab DELETE gate.
  const maySetup = Boolean(setup) && (await canEditRoboSetup());
  const onSetup = wantsSetup && maySetup;

  // How many slabs this one setup speaks for. Counted rather than fetched:
  // a full batch is hundreds of rows and the screen only needs the number.
  const slabCount = onSetup && setup
    ? await prisma.roboProductionRecord.count({ where: { batchRecipeId: setup.id } })
    : 0;

  const slabHref = `/robo/slabs/${id}/edit`;
  const setupHref = `${slabHref}?section=setup`;
  const backHref = `/robo/slabs/${id}`;

  const tab = (href: string, text: string, active: boolean) => (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
        active ? "bg-brand text-white shadow-sm" : "text-gray-600 hover:bg-gray-100"
      }`}
    >
      {text}
    </Link>
  );

  return (
    <Shell>
      <div className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <Link href={backHref} className="text-sm text-gray-400 hover:text-gray-600">← Complete Details</Link>
          <span className="text-gray-300">/</span>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Edit slab {record.slabNumber}</h1>
        </div>
        <p className="mt-1 text-sm text-gray-500">
          Shift {record.shift?.shiftNumber} · {record.shift?.date}
          {record.shift?.status === "CLOSED" ? " · this shift is closed — the correction still saves" : ""}
        </p>
      </div>

      <div className="max-w-4xl space-y-5">
        {/* Both ways in, side by side, so it is clear from here that the design
            and the machines are corrected somewhere other than the times. */}
        <div className="flex flex-wrap items-center gap-1 rounded-xl border border-gray-200 bg-white p-1 shadow-sm">
          {tab(slabHref, "Edit slab", !onSetup)}
          {maySetup
            ? tab(setupHref, "Edit setup", onSetup)
            : (
              <span
                title={setup
                  ? "Your role cannot change a production setup."
                  : "This slab was logged without a production setup, so there is nothing to correct."}
                className="cursor-not-allowed rounded-lg px-4 py-2 text-sm font-medium text-gray-300"
              >
                Edit setup
              </span>
            )}
          <span className="ml-auto pr-3 text-xs text-gray-400">
            {onSetup ? "Design, thickness and machines — shared by the batch" : "This slab's own numbers, times and delays"}
          </span>
        </div>

        {/* Asked for but not allowed. The slab form still renders below, so the
            click lands somewhere useful rather than on a dead end — but say
            which of the two reasons it is first, or it reads as the tab having
            been ignored. */}
        {wantsSetup && !maySetup && (
          <Card>
            <p className="text-sm text-gray-600">
              {setup
                ? "You do not have permission to change a production setup, so this slab's setup is shown read-only on its Complete Details page."
                : "This slab was logged without a production setup — there is no design or machine configuration attached to it to correct."}
            </p>
          </Card>
        )}

        {onSetup && setup ? (
          <RoboEntryForm
            setupEdit={{
              setup: {
                id: setup.id,
                productionDate: setup.productionDate,
                batchNo: setup.batchNo,
                designName: setup.designName,
                thickness: setup.thickness,
                targetSlabs: setup.targetSlabs,
                notes: setup.notes,
                entries: setup.entries,
              },
              slabCount,
              date: setupDate(setup.productionDate, record.shift?.date),
              today: plantDate(new Date()),
              backHref,
            }}
          />
        ) : (
          <RoboEntryForm recordId={id} />
        )}
      </div>
    </Shell>
  );
}
