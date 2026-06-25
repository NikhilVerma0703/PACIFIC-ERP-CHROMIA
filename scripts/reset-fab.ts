/**
 * FAB RESET + SEED SCRIPT
 * Run: npx tsx scripts/reset-fab.ts
 * LOCAL DEV ONLY.
 */
import { PrismaClient, FabRole, FabMachineType } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Clearing fab data...");

  await prisma.fabResidualPiece.deleteMany({});
  await prisma.fabResidualBag.deleteMany({});
  await prisma.fabDispatch.deleteMany({});
  await prisma.fabPackagePiece.deleteMany({});
  await prisma.fabPackage.deleteMany({});
  await prisma.fabPieceOperation.deleteMany({});
  await prisma.fabSlabAllocation.deleteMany({});
  await prisma.fabPiece.deleteMany({});
  await prisma.fabMachineSession.deleteMany({});
  await prisma.fabOperation.deleteMany({});
  await prisma.fabRequirementAllocation.deleteMany({});
  await prisma.fabRequirement.deleteMany({});
  await prisma.fabSlabJob.deleteMany({});
  await prisma.fabSlab.deleteMany({});
  await prisma.fabDrawing.deleteMany({});
  await prisma.fabProject.deleteMany({});

  console.log("OK - Fab tables cleared");

  // ── Machines ──────────────────────────────────────────────────────────────
  const machines = [
    { code: "CUT-01", name: "Cutting Machine 1",     type: FabMachineType.CUTTING      },
    { code: "CUT-02", name: "Cutting Machine 2",     type: FabMachineType.CUTTING      },
    { code: "POL-01", name: "Polishing Machine 1",   type: FabMachineType.POLISHING    },
    { code: "SNK-01", name: "Sink Cutter 1",         type: FabMachineType.SINK_CUTTING },
    { code: "FAB-01", name: "Fabrication Station 1", type: FabMachineType.FABRICATION  },
    { code: "PKG-01", name: "Packaging Station 1",   type: FabMachineType.PACKAGING    },
  ];
  for (const m of machines) {
    await prisma.fabMachine.upsert({
      where:  { code: m.code },
      update: { name: m.name, type: m.type },
      create: m,
    });
  }
  console.log("OK - " + machines.length + " machines upserted");

  // ── Users ─────────────────────────────────────────────────────────────────
  const pw = await bcrypt.hash("Pacific@123", 10);
  const fabUsers = [
    { name: "Fab Admin",      email: "fabadmin@thepacific.group",    fabRole: FabRole.FAB_ADMIN      },
    { name: "Fab Manager",    email: "fabmanager@thepacific.group",  fabRole: FabRole.FAB_MANAGER    },
    { name: "Supervisor Ali", email: "supervisor@thepacific.group",  fabRole: FabRole.FAB_SUPERVISOR },
    { name: "Will Smith",     email: "willsmith@thepacific.group",   fabRole: FabRole.FAB_EMPLOYEE   },
    { name: "Raj Kumar",      email: "raj@thepacific.group",         fabRole: FabRole.FAB_EMPLOYEE   },
    { name: "Ajith Nair",     email: "ajith@thepacific.group",       fabRole: FabRole.FAB_EMPLOYEE   },
    { name: "Ashwin Prasad",  email: "ashwin@thepacific.group",      fabRole: FabRole.FAB_EMPLOYEE   },
    { name: "Ravi Shankar",   email: "ravi@thepacific.group",        fabRole: FabRole.FAB_EMPLOYEE   },
    { name: "Arun Menon",     email: "arun@thepacific.group",        fabRole: FabRole.FAB_EMPLOYEE   },
    { name: "Sanju Thomas",   email: "sanju@thepacific.group",       fabRole: FabRole.FAB_EMPLOYEE   },
    { name: "Vivek Pillai",   email: "vivek@thepacific.group",       fabRole: FabRole.FAB_EMPLOYEE   },
    { name: "Deepak Varma",   email: "deepak@thepacific.group",      fabRole: FabRole.FAB_EMPLOYEE   },
    { name: "Suresh Babu",    email: "suresh@thepacific.group",      fabRole: FabRole.FAB_EMPLOYEE   },
  ];
  for (const u of fabUsers) {
    await prisma.user.upsert({
      where:  { email: u.email },
      update: { name: u.name, fabRole: u.fabRole, passwordHash: pw, active: true },
      create: { name: u.name, email: u.email, fabRole: u.fabRole, passwordHash: pw,
                role: "OPERATOR", active: true },
    });
  }
  console.log("OK - " + fabUsers.length + " users upserted");

  // ── 30 slabs ──────────────────────────────────────────────────────────────
  const DESIGNS: [string, string][] = [
    ["Calacatta Gold",  "CG"],
    ["Statuario White", "SW"],
    ["Nero Marquina",   "NM"],
    ["Bianco Carrara",  "BC"],
    ["Emperador Dark",  "ED"],
    ["Rosso Levanto",   "RL"],
    ["Verde Guatemala", "VG"],
    ["Portoro Gold",    "PG"],
    ["Crema Marfil",    "CM"],
    ["Absolute Black",  "AB"],
  ];
  const THICK = ["20mm", "20mm", "30mm"];
  const GRADE = ["A",    "A",    "A",    "B"];

  for (let i = 0; i < 30; i++) {
    const [design, code] = DESIGNS[i % DESIGNS.length];
    const thick = THICK[i % THICK.length];
    const grade = GRADE[i % GRADE.length];
    const pad   = String(i + 1).padStart(3, "0");
    const data  = {
      airtableId:    "TEST-SLB-" + pad,
      design,
      sku:           code + "-" + thick.replace("mm", "") + "MM-" + pad,
      slabThickness: thick,
      qualityGrade:  grade,
    };
    await prisma.polishQc.upsert({
      where:  { airtableId: data.airtableId },
      update: data,
      create: data,
    });
  }
  console.log("OK - 30 slabs upserted");

  console.log("\nReset complete!  Password for all users: Pacific@123");
  console.log("\nUsers:");
  for (const u of fabUsers) {
    console.log("  " + u.fabRole.padEnd(16) + "  " + u.email);
  }
}

main()
  .catch(e => { console.error("Error:", e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
