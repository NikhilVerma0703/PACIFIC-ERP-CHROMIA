import { PrismaClient, Role, FabRole, FabMachineType } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const DEFAULT_PASSWORD = "Pacific@123";

const USERS: Array<{
  email: string;
  name: string;
  role: Role;
  fabRole?: FabRole;
}> = [
  { email: "admin@thepacific.group",                name: "Administrator",  role: Role.ADMIN,        fabRole: FabRole.FAB_ADMIN },
  { email: "mohamed.shalman@thepacific.group",      name: "Shalman",        role: Role.ADMIN,        fabRole: FabRole.FAB_ADMIN },
  { email: "manager@thepacific.group",              name: "Fab Manager",    role: Role.LINE_MANAGER, fabRole: FabRole.FAB_MANAGER },
  { email: "supervisor@thepacific.group",           name: "Fab Supervisor", role: Role.INCHARGE,     fabRole: FabRole.FAB_SUPERVISOR },
  { email: "cutter@thepacific.group",               name: "Cutter",        role: Role.OPERATOR,     fabRole: FabRole.FAB_EMPLOYEE },
  { email: "polisher@thepacific.group",             name: "Polisher",      role: Role.OPERATOR,     fabRole: FabRole.FAB_EMPLOYEE },
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
      update: { name: u.name, role: u.role, fabRole: u.fabRole ?? null },
      create: { email: u.email, name: u.name, passwordHash, role: u.role, fabRole: u.fabRole ?? null },
    });
    console.log(`Seeded user: ${u.email} (${u.role}${u.fabRole ? " / " + u.fabRole : ""})`);
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
