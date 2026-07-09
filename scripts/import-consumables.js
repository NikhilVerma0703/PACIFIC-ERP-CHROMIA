// Consumables one-shot seed + June-2026 import (ported from the module's
// prisma/seed.ts + importRealData.ts). Idempotent: upserts departments,
// re-seeds the small master tables, and date-scope-deletes before importing
// consumption rows. Run from the repo root:
//   node scripts/import-consumables.js
const fs = require("fs");
const path = require("path");
for (const l of fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8").split("\n")) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const DEPARTMENTS = ["Mixer", "Distributor", "Press", "LB Line", "Raw Material", "Silos", "Production", "Polishing"];
const DIRECT_MATERIALS = [
  { name: "Quartz Grit", variant: "A&A Silicates 0.1-0.4MM", unit: "KG", dailyConsumption: 1200, status: "ACTIVE" },
  { name: "Quartz Grit", variant: "Phenikaa Cristobalite 0.1-0.4MM", unit: "KG", dailyConsumption: 900, status: "ACTIVE" },
  { name: "Quartz Powder", variant: "A&A Silicates 400#", unit: "KG", dailyConsumption: 800, status: "ACTIVE" },
  { name: "Resin", variant: "Orson", unit: "KG", dailyConsumption: 350, status: "ACTIVE" },
  { name: "Resin", variant: "Ineos", unit: "KG", dailyConsumption: 250, status: "ACTIVE" },
  { name: "Catalyst", variant: "Catalyst 93", unit: "KG", dailyConsumption: 75, status: "ACTIVE" },
  { name: "Catalyst", variant: "Catalyst S21", unit: "KG", dailyConsumption: 0, status: "INACTIVE" },
  { name: "Catalyst", variant: "Catalyst Ambani", unit: "KG", dailyConsumption: 0, status: "INACTIVE" },
  { name: "Cobalt", variant: "Cobalt Ambani", unit: "Can", dailyConsumption: 0.33, status: "ACTIVE" },
  { name: "Cobalt", variant: "Cobalt Nouryon", unit: "Can", dailyConsumption: 0.07, status: "ACTIVE" },
  { name: "Silane", variant: "Standard", unit: "Can", dailyConsumption: 4, status: "ACTIVE" },
  { name: "TiO2", variant: "Standard", unit: "KG", dailyConsumption: 50, status: "ACTIVE" },
  { name: "Pigment", variant: "Standard", unit: "KG", dailyConsumption: 35, status: "ACTIVE" },
];
const PRODUCTION_CONSUMABLES = [
  { name: "Moulds", unit: "PCS", dailyConsumption: 10, currentStock: 200, minStock: 50 },
  { name: "PVA Roll", unit: "Roll", dailyConsumption: 1, currentStock: 40, minStock: 10 },
  { name: "Glue Can", unit: "KG", dailyConsumption: 20, currentStock: 85, minStock: 30 },
  { name: "Guard Sheets", unit: "PCS", dailyConsumption: 50, currentStock: 500, minStock: 100 },
  { name: "Gas", unit: "Cylinder", dailyConsumption: 2, currentStock: 8, minStock: 3 },
  { name: "Cotton Waste", unit: "KG", dailyConsumption: 15, currentStock: 120, minStock: 30 },
  { name: "Acetone", unit: "KG", dailyConsumption: 50, currentStock: 5000, minStock: 1000 },
  { name: "Gloves", unit: "Set", dailyConsumption: 20, currentStock: 800, minStock: 200 },
  { name: "Coolant Oil", unit: "Litre", dailyConsumption: 5, currentStock: 60, minStock: 20 },
  { name: "Soap Oil", unit: "Litre", dailyConsumption: 3, currentStock: 45, minStock: 15 },
  { name: "Mask N95", unit: "PCS", dailyConsumption: 10, currentStock: 1200, minStock: 300 },
  { name: "Ear Plug", unit: "PCS", dailyConsumption: 20, currentStock: 15, minStock: 20 },
  { name: "Scrapper", unit: "PCS", dailyConsumption: 2, currentStock: 25, minStock: 10 },
  { name: "Stationery Items", unit: "Set", dailyConsumption: 1, currentStock: 30, minStock: 5 },
];
const POLISHING_CONSUMABLES = ["Calibration", "Polishing", "Slab Repair + Sealant", "Musa Edge Polishing", "Hand Polishing"];
const INVENTORY_ITEMS = [
  { itemName: "Acetone", category: "PRODUCTION_CONSUMABLE", unit: "KG", currentStock: 5000, minStock: 1000 },
  { itemName: "Mask N95", category: "PRODUCTION_CONSUMABLE", unit: "PCS", currentStock: 1200, minStock: 300 },
  { itemName: "Gloves", category: "PRODUCTION_CONSUMABLE", unit: "Set", currentStock: 800, minStock: 200 },
  { itemName: "Catalyst 93", category: "DIRECT_MATERIAL", unit: "KG", currentStock: 150, minStock: 300 },
  { itemName: "Ear Plug", category: "PRODUCTION_CONSUMABLE", unit: "PCS", currentStock: 15, minStock: 20 },
];
const FILM_ROLLS = [
  { rollNumber: "FILM001", filmType: "Adhesive Film", machine: "Mixer Unloading Cabin", initialWeight: 40, layersUsed: 5, weightPerLayer: 1.4, isActive: true },
  { rollNumber: "FILM002", filmType: "PET Coil", machine: "Distributor Belt", initialWeight: 40, layersUsed: 8, weightPerLayer: 1.2, isActive: true },
  { rollNumber: "FILM003", filmType: "Antistatic Film", machine: "Crusher Belt", initialWeight: 40, layersUsed: 12, weightPerLayer: 1.5, isActive: true },
];

function getCategory(itemName) {
  const lower = itemName.toLowerCase();
  if (["catalyst", "cobalt", "silane", "resin", "quartz", "pigment", "tio2", "styrene", "monomer"].some((d) => lower.includes(d))) return "DIRECT_MATERIAL";
  if (["polish", "calibrat", "sealant", "abrasive", "buff", "musa", "diamond"].some((p) => lower.includes(p))) return "POLISHING_CONSUMABLE";
  return "PRODUCTION_CONSUMABLE";
}

async function main() {
  // One-shot guard: re-seeding would wipe live master edits (film-roll layer
  // counts, stock PATCHes). Refuse when data already exists unless --force.
  const existing = await prisma.consumptionEntry.count().catch(() => 0);
  const rolls = await prisma.filmRoll.count().catch(() => 0);
  if ((existing > 0 || rolls > 0) && !process.argv.includes("--force")) {
    console.error(`Refusing to re-seed: ${existing} consumption entries / ${rolls} film rolls already present. Re-run with --force if you really mean it.`);
    process.exit(1);
  }
  // ---- departments (upsert; never deleted) ----
  const departments = {};
  for (const name of DEPARTMENTS) {
    const d = await prisma.consumableDepartment.upsert({ where: { name }, update: {}, create: { name } });
    departments[name] = d.id;
  }
  console.log("departments:", Object.keys(departments).length);

  // ---- master tables (re-seed; consumable_* only) ----
  await prisma.directMaterial.deleteMany();
  await prisma.directMaterial.createMany({ data: DIRECT_MATERIALS });
  await prisma.productionConsumable.deleteMany();
  await prisma.productionConsumable.createMany({ data: PRODUCTION_CONSUMABLES.map((x) => ({ ...x, departmentId: departments["Production"] })) });
  await prisma.polishingConsumable.deleteMany();
  await prisma.polishingConsumable.createMany({ data: POLISHING_CONSUMABLES.map((name) => ({ name, departmentId: departments["Polishing"] })) });
  await prisma.filmRoll.deleteMany();
  await prisma.filmRoll.createMany({ data: FILM_ROLLS });
  console.log("masters seeded");

  // ---- inventory stock: create only what's missing (case-insensitive) ----
  const existingInv = await prisma.inventoryStock.findMany();
  const invMap = new Map(existingInv.map((i) => [i.itemName.toLowerCase(), i.id]));
  for (const item of INVENTORY_ITEMS) {
    if (!invMap.has(item.itemName.toLowerCase())) {
      const created = await prisma.inventoryStock.create({ data: item });
      invMap.set(item.itemName.toLowerCase(), created.id);
    }
  }

  // ---- June 2026 consumption import (date-scoped delete, then insert) ----
  const rows = JSON.parse(fs.readFileSync(path.join(__dirname, "consumption_june2026.json"), "utf8"));
  const times = rows.map((r) => new Date(r.date).getTime()).filter(Number.isFinite);
  if (times.length) {
    const del = await prisma.consumptionEntry.deleteMany({
      where: { date: { gte: new Date(Math.min(...times)), lt: new Date(Math.max(...times) + 86400000) } },
    });
    console.log("cleared in-range entries:", del.count);
  }
  let skipped = 0; const missing = new Set(); const data = [];
  for (const r of rows) {
    const deptId = departments[r.department];
    if (!deptId) { missing.add(r.department); skipped++; continue; }
    let invId = invMap.get(r.itemName.toLowerCase());
    if (!invId) {
      const item = await prisma.inventoryStock.create({ data: { itemName: r.itemName, category: getCategory(r.itemName), unit: r.unit, currentStock: 0, minStock: 0 } });
      invMap.set(r.itemName.toLowerCase(), item.id); invId = item.id;
    }
    data.push({ date: new Date(r.date), itemName: r.itemName, quantity: r.quantity, unit: r.unit, departmentId: deptId, inventoryStockId: invId });
  }
  for (let i = 0; i < data.length; i += 500) await prisma.consumptionEntry.createMany({ data: data.slice(i, i + 500) });
  console.log("imported:", data.length, "| skipped:", skipped, missing.size ? "| missing depts: " + [...missing].join(", ") : "");
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); }).finally(() => prisma.$disconnect());
