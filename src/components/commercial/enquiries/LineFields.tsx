"use client";
// One enquiry line, as inputs. Shared by the new-enquiry form (which keeps its
// lines in local state until the enquiry is created) and the enquiry page
// (which saves each line on its own).
//
// A line must name our design OR the customer's SKU: an enquiry line that
// names neither describes nothing, and the API refuses it. Thickness is
// offered as the canonical list and stored canonically ('2 cm'); the PI and
// the invoice print it their own way (30mm, 2 CM).
import { THICKNESS_OPTS } from "@/lib/thickness";

export interface LineDraft {
  design: string;
  customerSku: string;
  thickness: string;
  finish: string;
  qtySlabs: string;
  qtySqft: string;
  notes: string;
}

export interface EnquiryItemRow {
  id: string;
  lineNo: number;
  design: string | null;
  customerSku: string | null;
  thickness: string | null;
  finish: string | null;
  qtySlabs: number | null;
  qtySqft: number | null;
  notes: string | null;
}

export const emptyLine = (): LineDraft => ({ design: "", customerSku: "", thickness: "", finish: "", qtySlabs: "", qtySqft: "", notes: "" });

export const lineFrom = (r: EnquiryItemRow): LineDraft => ({
  design: r.design ?? "",
  customerSku: r.customerSku ?? "",
  thickness: r.thickness ?? "",
  finish: r.finish ?? "",
  qtySlabs: r.qtySlabs === null || r.qtySlabs === undefined ? "" : String(r.qtySlabs),
  qtySqft: r.qtySqft === null || r.qtySqft === undefined ? "" : String(r.qtySqft),
  notes: r.notes ?? "",
});

export const lineBody = (d: LineDraft): Record<string, string> => ({ ...d });

/** Is there anything on this line worth sending? The API's own check is the
 *  authority; this only keeps a blank spare row out of the request. */
export const lineIsEmpty = (d: LineDraft): boolean =>
  !Object.values(d).some((v) => String(v).trim());

const cell = "w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm shadow-sm transition focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/30 disabled:bg-gray-50 disabled:text-gray-400";

export function LineInputs({ value, onChange, disabled = false }: {
  value: LineDraft;
  onChange: (next: LineDraft) => void;
  disabled?: boolean;
}) {
  const set = (k: keyof LineDraft) => (e: { target: { value: string } }) => onChange({ ...value, [k]: e.target.value });
  return (
    <>
      <td className="px-2 py-2"><input className={cell} value={value.design} onChange={set("design")} disabled={disabled} placeholder="Carrara Royale" /></td>
      <td className="px-2 py-2"><input className={cell} value={value.customerSku} onChange={set("customerSku")} disabled={disabled} placeholder="VGWT10301A" /></td>
      <td className="px-2 py-2">
        <input className={cell} value={value.thickness} onChange={set("thickness")} disabled={disabled} placeholder="20mm" list="commercial-thickness-opts" />
      </td>
      <td className="px-2 py-2"><input className={cell} value={value.finish} onChange={set("finish")} disabled={disabled} placeholder="Polish" /></td>
      <td className="px-2 py-2"><input className={`${cell} text-right`} value={value.qtySlabs} onChange={set("qtySlabs")} disabled={disabled} inputMode="numeric" placeholder="12" /></td>
      <td className="px-2 py-2"><input className={`${cell} text-right`} value={value.qtySqft} onChange={set("qtySqft")} disabled={disabled} inputMode="decimal" placeholder="784.887" /></td>
      <td className="px-2 py-2"><input className={cell} value={value.notes} onChange={set("notes")} disabled={disabled} placeholder="Same batch" /></td>
    </>
  );
}

/** The <datalist> the thickness inputs read. Rendered once per screen. */
export function ThicknessOptions() {
  return (
    <datalist id="commercial-thickness-opts">
      {THICKNESS_OPTS.map((t) => <option key={t} value={t} />)}
    </datalist>
  );
}

export function LineHeader() {
  return (
    <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
      <th className="px-2 py-2 font-medium">Design</th>
      <th className="px-2 py-2 font-medium">Customer SKU</th>
      <th className="px-2 py-2 font-medium">Thickness</th>
      <th className="px-2 py-2 font-medium">Finish</th>
      <th className="px-2 py-2 text-right font-medium">Slabs</th>
      <th className="px-2 py-2 text-right font-medium">Sq ft</th>
      <th className="px-2 py-2 font-medium">Notes</th>
      <th className="px-2 py-2 font-medium" />
    </tr>
  );
}
