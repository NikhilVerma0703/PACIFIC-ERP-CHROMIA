// Shift/hour buckets shared by the MIS sheet (client) and shift reports
// (server). MUST stay dependency-free: the client component imports it, so
// no prisma / server-only imports here.
export const SHIFT_HOURS: Record<"A" | "B" | "C", string[]> = {
  A: ["06 - 07", "07 - 08", "08 - 09", "09 - 10", "10 - 11", "11 - 12", "12 - 13", "13 - 14"],
  B: ["14 - 15", "15 - 16", "16 - 17", "17 - 18", "18 - 19", "19 - 20", "20 - 21", "21 - 22"],
  C: ["22 - 23", "23 - 00", "00 - 01", "01 - 02", "02 - 03", "03 - 04", "04 - 05", "05 - 06"],
};
export const SHIFT_WINDOW: Record<"A" | "B" | "C", string> = { A: "06:00–14:00", B: "14:00–22:00", C: "22:00–06:00" };
export const shiftOfHour = (hour: string): "A" | "B" | "C" => {
  const h = Number(hour.slice(0, 2));
  if (h >= 6 && h < 14) return "A";
  if (h >= 14 && h < 22) return "B";
  return "C";
};
