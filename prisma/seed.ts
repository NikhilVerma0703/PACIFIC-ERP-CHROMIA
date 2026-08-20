import { PrismaClient, Role, FabMachineType } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const DEFAULT_PASSWORD = process.env.SEED_PASSWORD || "Pacific@123";

const USERS: Array<{
  email: string;
  name: string;
  role: Role;
  branch?: string;
}> = [
  { email: "admin@thepacific.group",           name: "Administrator",  role: Role.ADMIN },
  { email: "mohamed.shalman@thepacific.group", name: "Shalman",        role: Role.ADMIN },
  { email: "manager@thepacific.group",         name: "Fab Manager",    role: Role.LINE_MANAGER, branch: "FABRICATION" },
  { email: "supervisor@thepacific.group",      name: "Fab Supervisor", role: Role.INCHARGE,     branch: "FABRICATION" },
  { email: "cutter@thepacific.group",          name: "Cutter",         role: Role.OPERATOR,     branch: "FABRICATION" },
  { email: "polisher@thepacific.group",        name: "Polisher",       role: Role.OPERATOR,     branch: "FABRICATION" },
  { email: "operator@thepacific.group",        name: "Fab Operator",   role: Role.OPERATOR,     branch: "FABRICATION" },
];

const MACHINES = [
  { code: "CUT-01", name: "CNC Cutter 1",     type: "CUTTING"      as FabMachineType },
  { code: "CUT-02", name: "CNC Cutter 2",     type: "CUTTING"      as FabMachineType },
  { code: "POL-01", name: "Polisher 1",        type: "POLISHING"    as FabMachineType },
  { code: "POL-02", name: "Polisher 2",        type: "POLISHING"    as FabMachineType },
  { code: "SNK-01", name: "Sink Cutter 1",     type: "SINK_CUTTING" as FabMachineType },
  { code: "FAB-01", name: "Fabrication Bay 1", type: "FABRICATION"  as FabMachineType },
  { code: "PKG-01", name: "Packaging Station", type: "PACKAGING"    as FabMachineType },
];

async function main() {
  // Seed users
  for (const u of USERS) {
    const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
    await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name, role: u.role, branch: (u.branch ?? "SHOP_FLOOR") as any },
      create: { email: u.email, name: u.name, passwordHash, role: u.role, branch: (u.branch ?? "SHOP_FLOOR") as any },
    });
    console.log(`Seeded user: ${u.email} (${u.role}${u.branch ? " / " + u.branch : ""})`);
  }

  // Seed machines
  for (const m of MACHINES) {
    await prisma.fabMachine.upsert({
      where: { code: m.code },
      update: {},
      create: { code: m.code, name: m.name, type: m.type },
    });
    console.log(`Seeded machine: ${m.code} — ${m.name} (${m.type})`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
