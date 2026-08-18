/**
 * Chromia module — reference data seed.
 *
 * Stage definitions, locations, machines, base materials, designs, defect
 * types and recalibration reasons: the master lists the module's screens read
 * on every page. No slabs or transactions — production data is entered through
 * the application.
 *
 * Idempotent: every write is an upsert keyed on a business code, so it can be
 * run repeatedly and after every schema change.
 *
 * The chromia_user rows it writes are the module's dormant employee directory
 * (see the CHROMIA MODULE banner in schema.prisma). Sign-in is the ERP's:
 * a Chromia login is a users row with role CHROMIA.
 *
 *   npm run db:seed:chromia
 */
import { PrismaClient } from '@prisma/client';
import { ChromiaDefectSeverity as DefectSeverity, ChromiaLocationType as LocationType, ChromiaMachineType as MachineType, ChromiaProcessStage as ProcessStage, ChromiaRole as Role, ChromiaUserStatus as UserStatus } from '@prisma/client';

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

const STAGE_DEFINITIONS = [
  {
    stage: ProcessStage.INCOMING,
    sequence: 1,
    name: 'Incoming Slab',
    description: 'Physical receipt of the raw base slab; the slab gains its digital identity.',
    expectedDurationMinutes: 15,
    requiresMachine: false,
  },
  {
    stage: ProcessStage.INCOMING_DETAILS,
    sequence: 2,
    name: 'Incoming Details',
    description: 'Registration and technical classification; fitness to enter the process.',
    expectedDurationMinutes: 20,
    requiresMachine: false,
  },
  {
    stage: ProcessStage.BASE_PRIMER,
    sequence: 3,
    name: 'Base Primer',
    description: 'Primer coat providing the uniform foundation for the digital print.',
    expectedDurationMinutes: 45,
    requiresMachine: true,
  },
  {
    stage: ProcessStage.PRINTING,
    sequence: 4,
    name: 'Printing',
    description: 'Digital printing of the decorative design onto the primed surface.',
    expectedDurationMinutes: 40,
    requiresMachine: true,
  },
  {
    stage: ProcessStage.MOULDING,
    sequence: 5,
    name: 'Moulding',
    description: 'Heat and pressure forming that fixes the printed layer.',
    expectedDurationMinutes: 90,
    requiresMachine: true,
  },
  {
    stage: ProcessStage.COOLING,
    sequence: 6,
    name: 'Cooling',
    description: 'Controlled cooling to relieve internal stress. Dwell stage.',
    expectedDurationMinutes: 240,
    requiresMachine: false,
  },
  {
    stage: ProcessStage.POLISHING,
    sequence: 7,
    name: 'Polishing',
    description: 'Mechanical polishing to the specified gloss and surface uniformity.',
    expectedDurationMinutes: 60,
    requiresMachine: true,
  },
  {
    stage: ProcessStage.UV_POLISHING,
    sequence: 8,
    name: 'UV Polishing',
    description: 'UV-cured protective top coat delivering final gloss and durability.',
    expectedDurationMinutes: 40,
    requiresMachine: true,
  },
  {
    stage: ProcessStage.QUALITY_CHECK,
    sequence: 9,
    name: 'Quality Check',
    description: 'Formal inspection against the Chromia quality standard.',
    expectedDurationMinutes: 30,
    requiresMachine: false,
  },
  {
    stage: ProcessStage.GRADE_DECISION,
    sequence: 10,
    name: 'Grade Decision',
    description: 'Commercial grading and assignment of the slab disposition.',
    expectedDurationMinutes: 10,
    requiresMachine: false,
  },
] as const;

const USERS = [
  {
    employeeCode: 'ADM001',
    name: 'System Administrator',
    email: 'admin@chromia.local',
    role: Role.ADMIN,
  },
  {
    employeeCode: 'PM001',
    name: 'Production Manager',
    email: 'manager@chromia.local',
    role: Role.PRODUCTION_MANAGER,
  },
  {
    employeeCode: 'SUP001',
    name: 'Shift Supervisor',
    email: 'supervisor@chromia.local',
    role: Role.SUPERVISOR,
  },
  {
    employeeCode: 'OPR001',
    name: 'Line Operator',
    email: 'operator@chromia.local',
    role: Role.OPERATOR,
  },
  {
    employeeCode: 'QC001',
    name: 'Quality Inspector',
    email: 'quality@chromia.local',
    role: Role.QUALITY_INSPECTOR,
  },
  {
    employeeCode: 'STK001',
    name: 'Store Keeper',
    email: 'store@chromia.local',
    role: Role.STORE_KEEPER,
  },
  {
    employeeCode: 'VW001',
    name: 'Management Viewer',
    email: 'viewer@chromia.local',
    role: Role.VIEWER,
  },
] as const;

const LOCATIONS = [
  { code: 'YARD-IN', name: 'Incoming Yard', type: LocationType.YARD },
  { code: 'RACK-A', name: 'Raw Slab Rack A', type: LocationType.RACK },
  { code: 'RACK-B', name: 'Raw Slab Rack B', type: LocationType.RACK },
  { code: 'BAY-PRIMER', name: 'Primer Line Bay', type: LocationType.MACHINE_BAY },
  { code: 'BAY-PRINT', name: 'Printing Bay', type: LocationType.MACHINE_BAY },
  { code: 'BAY-MOULD', name: 'Moulding Bay', type: LocationType.MACHINE_BAY },
  { code: 'COOL-1', name: 'Cooling Zone 1', type: LocationType.COOLING_ZONE, capacity: 60 },
  { code: 'COOL-2', name: 'Cooling Zone 2', type: LocationType.COOLING_ZONE, capacity: 60 },
  { code: 'BAY-POLISH', name: 'Polishing Line Bay', type: LocationType.MACHINE_BAY },
  { code: 'BAY-UV', name: 'UV Line Bay', type: LocationType.MACHINE_BAY },
  { code: 'QC-AREA', name: 'Quality Inspection Area', type: LocationType.QC_AREA },
  { code: 'DISPATCH', name: 'Dispatch Bay', type: LocationType.DISPATCH_BAY },
  { code: 'STOCK-1', name: 'Finished Stock Rack 1', type: LocationType.STOCK_RACK, capacity: 200 },
  { code: 'SAMPLE', name: 'Sample Cutting Area', type: LocationType.SAMPLE_AREA },
  {
    code: 'RECAL-EXT',
    name: 'External Recalibration Facility',
    type: LocationType.EXTERNAL_FACILITY,
  },
  { code: 'WASTE', name: 'Waste / Write-off Area', type: LocationType.WASTE_AREA },
] as const;

const MACHINES = [
  {
    code: 'PRM-01',
    name: 'Primer Line 1',
    type: MachineType.PRIMER_LINE,
    stage: ProcessStage.BASE_PRIMER,
    locationCode: 'BAY-PRIMER',
  },
  {
    code: 'PRN-01',
    name: 'Digital Printer 1',
    type: MachineType.PRINTER,
    stage: ProcessStage.PRINTING,
    locationCode: 'BAY-PRINT',
  },
  {
    code: 'PRN-02',
    name: 'Digital Printer 2',
    type: MachineType.PRINTER,
    stage: ProcessStage.PRINTING,
    locationCode: 'BAY-PRINT',
  },
  {
    code: 'MLD-01',
    name: 'Moulding Press 1',
    type: MachineType.MOULDING_PRESS,
    stage: ProcessStage.MOULDING,
    locationCode: 'BAY-MOULD',
  },
  {
    code: 'COOL-R1',
    name: 'Cooling Rack 1',
    type: MachineType.COOLING_RACK,
    stage: ProcessStage.COOLING,
    locationCode: 'COOL-1',
  },
  {
    code: 'POL-01',
    name: 'Polishing Line 1',
    type: MachineType.POLISHING_LINE,
    stage: ProcessStage.POLISHING,
    locationCode: 'BAY-POLISH',
  },
  {
    code: 'UV-01',
    name: 'UV Coating Line 1',
    type: MachineType.UV_LINE,
    stage: ProcessStage.UV_POLISHING,
    locationCode: 'BAY-UV',
  },
] as const;

/** Base materials observed in the production register. */
const BASE_MATERIALS = [
  { code: 'ROBO-TRAIL', name: 'Robo Trail' },
  { code: 'FLORENCE', name: 'Florence' },
  { code: 'COASTAL-PEARL', name: 'Coastal Pearl' },
  { code: 'CHERRY-HILL', name: 'Cherry Hill' },
  { code: 'BIANCO-CRISTALLO', name: 'Bianco Cristallo' },
  { code: 'ASTRAL-MIST', name: 'Astral Mist' },
  { code: 'MAPLE-GAZE', name: 'Maple Gaze' },
  { code: 'AUREATE', name: 'Aureate' },
] as const;

/** Print artwork observed in the production register. */
const DESIGNS = [
  { code: 'CRISTALLO-OG', name: 'Cristallo OG', fileName: 'cristallo og' },
  { code: 'LIGHTER-THAJ-3', name: 'Lighter Thaj 3', fileName: 'lighter THAJ 3' },
  { code: 'CRISTALLO-TRIAL-1', name: 'Cristallo Trial 1', fileName: 'cristallo trial 1' },
  { code: 'CRISTALLO-TRIAL-2', name: 'Cristallo Trial 2', fileName: 'cristallo trial 2' },
  { code: 'CRISTALLO-TRIAL-3', name: 'Cristallo Trial 3', fileName: 'cristallo trial 3' },
  { code: 'CRISTALLO-TRIAL-4', name: 'Cristallo Trial 4', fileName: 'cristallo trial 4' },
  { code: 'CRISTALLO-TRIAL-5', name: 'Cristallo Trial 5', fileName: 'cristallo trial 5' },
  { code: 'NEW-ELVION-FINAL-2', name: 'New Elvion Final 2', fileName: 'new Elvion final 2' },
  { code: 'ASTRAL-MIST-2', name: 'Astral Mist 2', fileName: 'Astral mist2' },
  { code: 'ALMOND-MIST-1', name: 'Almond Mist 1', fileName: 'AlmondMist1' },
  { code: 'CRISTALLO-NOVEIN-SS', name: 'Cristallo No Vein SS', fileName: 'CRISTALLONOVEINSS' },
  { code: 'TAJVEIN', name: 'Taj Vein', fileName: 'TAJVEIN' },
  { code: 'CRISTALLO-TRIAL-FINAL', name: 'Cristallo Trial Final', fileName: 'CRISTALL0TRAILFINAL' },
  { code: 'CRISTALLO-FINAL', name: 'Cristallo Final', fileName: 'CRISTALLOFINAL' },
] as const;


/**
 * The materials and design files actually used on the line, taken from the
 * PRO MAY register.
 *
 * They are seeded so the Operator Entry dropdowns are usable on a fresh
 * database, before any register has been imported. Spelling is left exactly as
 * the register writes it — the shop floor recognises "Bianco crisstallo", not a
 * tidied-up version of it — but entries differing only in case or spacing are
 * collapsed, because those are typing, not different products.
 */
const REGISTER_MATERIALS = [
  'Astral mist',
  'Astral mist 3cm',
  'Bianco crisstallo',
  'Bianco crisstallo 3cm',
  'CB -CB',
  'Florence',
  'Havelock',
  'IRISH CREAM',
  'Maple Gaze',
  'Oasis 2cm',
  'Stella',
  'amadus',
  'aureate 3cm',
  'cb',
  'cherry hill',
  'cherry hill 2cm',
  'cherry hill base',
  'coastal pearl',
  'coastal pearl (2cm)',
  'coastal pearl 3cm',
  'honey dew',
  'maple Gaze3cm',
  'maple gaze 2cm',
  'maple gaze 3cm',
  'no Bianco crisstallo',
  'robo trail',
  'trail',
  'ultimate white',
] as const;

const REGISTER_DESIGNS = [
  'AlmondMist1',
  'Astral mist2',
  'AstralLessveins02',
  'CALACATTA GREY2',
  'CHORIZONVEILOBGTRAIL',
  'CRISTALL0TRAILFINAL',
  'CRISTALLOFINAL',
  'CRISTALLONOVEINSS',
  'Elvionnovein',
  'Newelvionfinal2',
  'PATAGONIA1',
  'STATUARIONOBGTRAIL',
  'TAJVEIN',
  'calacatta gold',
  'calacattaviolatrail1',
  'cristallo og',
  'cristallo trial 1',
  'cristallo trial 2',
  'cristallo trial 3',
  'cristallo trial 4',
  'cristallo trial 5',
  'elviondarkveinsfinal',
  'lighter THAJ 3',
  'new Elvion final 2',
  'stonelilyTRAIL4',
  'whitemacabusTrail1',
  'whitemacabusTrail2',
] as const;

const RECALIBRATION_REASONS = [
  { code: 'HALF-PRINT', name: 'Half Print', originStage: ProcessStage.PRINTING },
  { code: 'RED-COLOUR', name: 'Red Colour Deviation', originStage: ProcessStage.PRINTING },
  { code: 'COLOUR-MISMATCH', name: 'Colour Mismatch', originStage: ProcessStage.PRINTING },
  { code: 'PRINT-MISREG', name: 'Print Misregistration', originStage: ProcessStage.PRINTING },
  { code: 'SURFACE-FINISH', name: 'Surface Finish Defect', originStage: ProcessStage.POLISHING },
  {
    code: 'GLOSS-OUT-OF-SPEC',
    name: 'Gloss Level Out of Specification',
    originStage: ProcessStage.UV_POLISHING,
  },
  { code: 'PRIMER-DEFECT', name: 'Primer Defect', originStage: ProcessStage.BASE_PRIMER },
  { code: 'MOULD-DEFECT', name: 'Moulding / Texture Defect', originStage: ProcessStage.MOULDING },
  { code: 'DIMENSIONAL', name: 'Dimensional Deviation', originStage: ProcessStage.MOULDING },
  // Named by the in-charge from the shop floor, August 2026.
  { code: 'ROLLER-MARK', name: 'Roller Mark', originStage: ProcessStage.BASE_PRIMER },
  { code: 'PRIMER-MARK', name: 'Primer Mark', originStage: ProcessStage.BASE_PRIMER },
  { code: 'FINGER-MARK', name: 'Finger / Thumb Mark', originStage: null },
  { code: 'UV-LIQUID', name: 'UV Liquid', originStage: ProcessStage.UV_POLISHING },
  { code: 'POLISH-HEAD-MARK', name: 'Polishing Head Mark', originStage: ProcessStage.POLISHING },
  { code: 'UV-BRUSH-MARK', name: 'UV Brush Mark', originStage: ProcessStage.UV_POLISHING },
  { code: 'SHADE-VARIATION', name: 'Shade Change / Variation', originStage: ProcessStage.PRINTING },
  {
    code: 'OVEN-TEMPERATURE',
    name: 'Temperature Problem at Oven',
    originStage: ProcessStage.MOULDING,
  },

  { code: 'OTHER', name: 'Other (see notes)', originStage: null },
] as const;

const DEFECT_TYPES = [
  {
    code: 'DEF-HALF-PRINT',
    name: 'Half Print',
    originStage: ProcessStage.PRINTING,
    defaultSeverity: DefectSeverity.CRITICAL,
  },
  {
    code: 'DEF-COLOUR-SHIFT',
    name: 'Colour Shift / Red Tone',
    originStage: ProcessStage.PRINTING,
    defaultSeverity: DefectSeverity.MAJOR,
  },
  {
    code: 'DEF-MISREG',
    name: 'Print Misregistration',
    originStage: ProcessStage.PRINTING,
    defaultSeverity: DefectSeverity.MAJOR,
  },
  {
    code: 'DEF-BUBBLE',
    name: 'Primer Bubbles / Streaks',
    originStage: ProcessStage.BASE_PRIMER,
    defaultSeverity: DefectSeverity.MAJOR,
  },
  {
    code: 'DEF-WARP',
    name: 'Warping / Edge Deformation',
    originStage: ProcessStage.MOULDING,
    defaultSeverity: DefectSeverity.CRITICAL,
  },
  {
    code: 'DEF-STRESS-CRACK',
    name: 'Stress Crack',
    originStage: ProcessStage.COOLING,
    defaultSeverity: DefectSeverity.CRITICAL,
  },
  {
    code: 'DEF-SCRATCH',
    name: 'Scratch / Swirl Mark',
    originStage: ProcessStage.POLISHING,
    defaultSeverity: DefectSeverity.MINOR,
  },
  {
    code: 'DEF-DULL',
    name: 'Dull Patch',
    originStage: ProcessStage.POLISHING,
    defaultSeverity: DefectSeverity.MINOR,
  },
  {
    code: 'DEF-ORANGE-PEEL',
    name: 'Orange Peel',
    originStage: ProcessStage.UV_POLISHING,
    defaultSeverity: DefectSeverity.MAJOR,
  },
  {
    code: 'DEF-PINHOLE',
    name: 'Pinhole / Dust Inclusion',
    originStage: ProcessStage.UV_POLISHING,
    defaultSeverity: DefectSeverity.MINOR,
  },
  {
    code: 'DEF-EDGE-CHIP',
    name: 'Edge Chip',
    originStage: null,
    defaultSeverity: DefectSeverity.MAJOR,
  },
  {
    code: 'DEF-DIMENSION',
    name: 'Dimensional Deviation',
    originStage: null,
    defaultSeverity: DefectSeverity.MAJOR,
  },
] as const;

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

async function seedStageDefinitions(): Promise<void> {
  for (const definition of STAGE_DEFINITIONS) {
    await prisma.chromiaStageDefinition.upsert({
      where: { stage: definition.stage },
      update: {
        sequence: definition.sequence,
        name: definition.name,
        description: definition.description,
        expectedDurationMinutes: definition.expectedDurationMinutes,
        warnAfterMinutes: Math.round(definition.expectedDurationMinutes * 1.5),
        requiresMachine: definition.requiresMachine,
      },
      create: {
        stage: definition.stage,
        sequence: definition.sequence,
        name: definition.name,
        description: definition.description,
        expectedDurationMinutes: definition.expectedDurationMinutes,
        warnAfterMinutes: Math.round(definition.expectedDurationMinutes * 1.5),
        requiresMachine: definition.requiresMachine,
      },
    });
  }
  console.warn(`[seed] stage definitions: ${STAGE_DEFINITIONS.length}`);
}

async function seedUsers(): Promise<void> {
  for (const user of USERS) {
    await prisma.chromiaUser.upsert({
      where: { employeeCode: user.employeeCode },
      update: { name: user.name, email: user.email, role: user.role, status: UserStatus.ACTIVE },
      create: {
        employeeCode: user.employeeCode,
        name: user.name,
        email: user.email,
        role: user.role,
        status: UserStatus.ACTIVE,
      },
    });
  }
  console.warn(`[seed] users: ${USERS.length}`);
}

async function seedLocations(): Promise<void> {
  for (const location of LOCATIONS) {
    await prisma.chromiaLocation.upsert({
      where: { code: location.code },
      update: { name: location.name, type: location.type },
      create: {
        code: location.code,
        name: location.name,
        type: location.type,
        capacity: 'capacity' in location ? location.capacity : null,
      },
    });
  }
  console.warn(`[seed] locations: ${LOCATIONS.length}`);
}

async function seedMachines(): Promise<void> {
  for (const machine of MACHINES) {
    const location = await prisma.chromiaLocation.findUnique({ where: { code: machine.locationCode } });

    await prisma.chromiaMachine.upsert({
      where: { code: machine.code },
      update: {
        name: machine.name,
        type: machine.type,
        stage: machine.stage,
        locationId: location?.id ?? null,
      },
      create: {
        code: machine.code,
        name: machine.name,
        type: machine.type,
        stage: machine.stage,
        locationId: location?.id ?? null,
      },
    });
  }
  console.warn(`[seed] machines: ${MACHINES.length}`);
}

/**
 * A stable code for a register value.
 *
 * `update: {}` on the upsert means a re-run never overwrites a name somebody
 * has since corrected in the application — the seed adds, it does not police.
 */
function registerCode(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

async function seedBaseMaterials(): Promise<void> {
  for (const material of BASE_MATERIALS) {
    await prisma.chromiaBaseMaterial.upsert({
      where: { code: material.code },
      update: { name: material.name },
      create: { code: material.code, name: material.name },
    });
  }
  for (const name of REGISTER_MATERIALS) {
    const code = registerCode(name);
    await prisma.chromiaBaseMaterial.upsert({
      where: { code },
      update: {},
      create: { code, name },
    });
  }

  console.warn(
    `[seed] base materials: ${BASE_MATERIALS.length + REGISTER_MATERIALS.length}`,
  );
}

async function seedDesigns(): Promise<void> {
  for (const design of DESIGNS) {
    await prisma.chromiaDesign.upsert({
      where: { code: design.code },
      update: { name: design.name, fileName: design.fileName },
      create: { code: design.code, name: design.name, fileName: design.fileName },
    });
  }
  for (const name of REGISTER_DESIGNS) {
    const code = registerCode(name);
    await prisma.chromiaDesign.upsert({
      where: { code },
      update: {},
      create: { code, name, fileName: name },
    });
  }

  console.warn(`[seed] designs: ${DESIGNS.length + REGISTER_DESIGNS.length}`);
}

async function seedRecalibrationReasons(): Promise<void> {
  for (const reason of RECALIBRATION_REASONS) {
    await prisma.chromiaRecalibrationReason.upsert({
      where: { code: reason.code },
      update: { name: reason.name, originStage: reason.originStage },
      create: { code: reason.code, name: reason.name, originStage: reason.originStage },
    });
  }
  console.warn(`[seed] recalibration reasons: ${RECALIBRATION_REASONS.length}`);
}

async function seedDefectTypes(): Promise<void> {
  for (const defect of DEFECT_TYPES) {
    await prisma.chromiaDefectType.upsert({
      where: { code: defect.code },
      update: {
        name: defect.name,
        originStage: defect.originStage,
        defaultSeverity: defect.defaultSeverity,
      },
      create: {
        code: defect.code,
        name: defect.name,
        originStage: defect.originStage,
        defaultSeverity: defect.defaultSeverity,
      },
    });
  }
  console.warn(`[seed] defect types: ${DEFECT_TYPES.length}`);
}

async function main(): Promise<void> {
  console.warn('[seed] Chromia Module — seeding reference data…');

  await seedStageDefinitions();
  await seedUsers();
  await seedLocations();
  await seedMachines();
  await seedBaseMaterials();
  await seedDesigns();
  await seedRecalibrationReasons();
  await seedDefectTypes();

  console.warn('[seed] done.');
}

main()
  .catch((error: unknown) => {
    console.error('[seed] failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
