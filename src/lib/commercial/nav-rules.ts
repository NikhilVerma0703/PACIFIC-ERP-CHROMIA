// The Commercial module's sidebar rows and overview cards, derived from the
// AREA table and from nothing else (round two, answers 1 and 2: "new roles for
// each set of tasks … one role that sees only its screens"). Pure — no React,
// no Next, no Prisma, no auth — so `node --test` can pin the rows each desk
// gets and so the CLIENT nav can import it without dragging server code into
// the browser bundle.
//
// WHY A TABLE AND NOT A ROLE TEST. The sidebar used to read `role ===
// "COMMERCIAL_MANAGER" ? managerItems : commercialItems`, which is a second
// copy of the access rule kept by hand. With five commercial desks the copy
// cannot be kept honest: Raghav has no enquiries and Murali no dispatch check,
// and neither of them is the manager. One row per area the login actually
// reaches is the only arrangement that stays true when the table moves.
//
// ONE ROW PER AREA, and three areas get none. `checklist`, `stock` and
// `proforma` are TABS on an order, not screens of their own — Raghav's
// checklist write and Setumani's stock check are reached through the Orders
// row that is already there.
//
// A ROW IS A PROMISE THE APP HAS TO KEEP. Middleware refuses every path whose
// area this login was not given (maySeeCommercialModule), so a row shown
// without the area behind it is a visible link to /no-access. That is why
// `planning` and `settings` ask for WRITE rather than for "not none": answer 16
// made the production planner the admin's alone, and the settings form was
// never anybody else's.
import { COMMERCIAL_AREAS, type AreaAccess, type CommercialArea } from "./access-rules.ts";

export interface CommercialNavRow {
  /** The area this row leads to — also its stable key and the key the nav
   *  looks its icon up by. */
  area: CommercialArea;
  href: string;
  label: string;
  /** Every other row is a sub-path of the overview, so the sidebar's prefix
   *  rule would light Overview alongside whichever screen is open. */
  exact?: boolean;
  /** What this login may do there, so a read-only desk can be told so. */
  access: AreaAccess;
}

/** The pipeline order the owner works in: the enquiry comes in, the order is
 *  written, the goods are packed and checked, the documents go out. The two
 *  admin rows sit at the end because nobody else sees them. */
const ROWS: ReadonlyArray<{ area: CommercialArea; href: string; label: string; exact?: boolean; needs: "reach" | "write" }> = [
  { area: "overview",      href: "/office/commercial",                     label: "Overview",          exact: true, needs: "reach" },
  { area: "enquiries",     href: "/office/commercial/enquiries",           label: "Enquiries",                      needs: "reach" },
  { area: "orders",        href: "/office/commercial/orders",              label: "Orders",                         needs: "reach" },
  { area: "clients",       href: "/office/commercial/clients",             label: "Clients",                        needs: "reach" },
  { area: "packing",       href: "/office/commercial/packing-lists",       label: "Packing Lists",                  needs: "reach" },
  { area: "dispatchCheck", href: "/office/commercial/dispatch-check",      label: "Dispatch Check",                 needs: "reach" },
  { area: "invoices",      href: "/office/commercial/invoices",            label: "Invoices",                       needs: "reach" },
  { area: "challans",      href: "/office/commercial/challans",            label: "Delivery Challans",              needs: "reach" },
  // Off the settings page and onto its own screen (round two, answer 15), so
  // the manager keeps the codes and the colours without being handed the
  // numbering counters or the company master.
  { area: "designCodes",   href: "/office/commercial/design-codes",        label: "Design codes",                   needs: "reach" },
  { area: "settings",      href: "/office/commercial/settings",            label: "Settings",                       needs: "write" },
];

/** The areas that are reached through another row rather than through one of
 *  their own. Exported so the test can say WHY they are missing instead of
 *  simply not noticing them.
 *
 *  `planning` joined them on 2026-09-17 for a different reason from the other
 *  three: it is not a tab on an order, it LEFT THE MODULE. Production planning
 *  is its own Office tab at /office/production-planning now, so a Commercial
 *  sidebar row would point out of the module the sidebar belongs to. The area
 *  itself stays exactly as it was — it is still what decides who may plan, now
 *  through lib/production-plan/access-rules — and `production-planning` is
 *  still mapped in SEGMENT_AREA so the old path can gate its own redirect. */
export const AREAS_WITHOUT_A_ROW: readonly CommercialArea[] =
  COMMERCIAL_AREAS.filter((a) => !ROWS.some((r) => r.area === a));

/**
 * The rows this login gets, in pipeline order. Feed it
 * `commercialAreasFor(user)`; a missing or unknown area fails closed, so a
 * screen added to the nav table without a row in the access table is refused
 * rather than shown.
 */
export function commercialNavRows(areas: Partial<Record<CommercialArea, AreaAccess>> | null | undefined): CommercialNavRow[] {
  const out: CommercialNavRow[] = [];
  for (const r of ROWS) {
    const access = areas?.[r.area] ?? "none";
    if (access === "none") continue;
    if (r.needs === "write" && access !== "write") continue;
    out.push(r.exact ? { area: r.area, href: r.href, label: r.label, exact: true, access } : { area: r.area, href: r.href, label: r.label, access });
  }
  return out;
}
