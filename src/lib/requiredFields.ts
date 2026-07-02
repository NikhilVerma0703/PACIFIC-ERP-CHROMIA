// Client-safe map of MANDATORY entry-form fields per model (enforced both in
// the browser via `required` and on the server in createRow/saveRow).
// NOTE: supports text/select fields on the slab entry + edit forms. Before
// adding a bool field or a SmartRecordForm (non-slab) model here, wire the
// client `required` hint into those render paths too.
export const REQUIRED_FORM_FIELDS: Record<string, string[]> = {
  PolishQc: ["polishType"],
};

export const REQUIRED_FIELD_LABELS: Record<string, string> = {
  polishType: "Polish Type",
};

export function isRequiredField(model: string, field: string): boolean {
  return (REQUIRED_FORM_FIELDS[model] ?? []).includes(field);
}
