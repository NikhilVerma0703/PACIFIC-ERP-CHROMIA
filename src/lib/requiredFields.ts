// Client-safe map of MANDATORY entry-form fields per model (enforced both in
// the browser via `required` and on the server in createRow/saveRow).
// NOTE: supports text/select fields on the slab entry + edit forms. Before
// adding a bool field or a SmartRecordForm (non-slab) model here, wire the
// client `required` hint into those render paths too.
export const REQUIRED_FORM_FIELDS: Record<string, string[]> = {
  PolishQc: ["polishType"],
  // The shift incentive is paid to whoever this names. An hour that names
  // nobody puts its slabs in the plant total and on no one's row, which
  // quietly raises everyone else's share — 17 of July's 85 shifts did exactly
  // that. The MIS sheet already defaults it to the signed-in operator, so
  // requiring it costs the floor nothing.
  Mis: ["productionInchargeName"],
};

export const REQUIRED_FIELD_LABELS: Record<string, string> = {
  polishType: "Polish Type",
  productionInchargeName: "Production Incharge",
};

export function isRequiredField(model: string, field: string): boolean {
  return (REQUIRED_FORM_FIELDS[model] ?? []).includes(field);
}
