import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  // Machines
  const machines = [
    { name: "Roycut-1", type: "ROYCUT" },
    { name: "Roycut-2", type: "ROYCUT" },
    { name: "Roycut-3", type: "ROYCUT" },
    { name: "Roymix",   type: "ROYMIX" },
  ];
  for (const m of machines) {
    await prisma.roboMachine.upsert({ where: { name: m.name }, update: {}, create: m });
  }

  // Operators
  const operators = ["Operator A", "Operator B", "Operator C", "Operator D"];
  for (const name of operators) {
    await prisma.roboOperator.upsert({ where: { name }, update: {}, create: { name } });
  }

  // Tools, Liquids, Powders
  const tools = ["BOAT 120","BOAT 100","SMALL","KNIFE","SOMBRERO-20","ERPICE MOD","DISCOFAT","PAINTING TOOL","ERPICE BRETON","DISCOTHIN"];
  for (const name of tools) await prisma.roboTool.upsert({ where: { name }, update: {}, create: { name } });

  const liquids = ["CB-GOLD3","LG5","LVB2","MM-WHITE","LG1","COSTA 703","DARK GREY","IKOS WHITE"];
  for (const name of liquids) await prisma.roboLiquid.upsert({ where: { name }, update: {}, create: { name } });

  const powders = ["DVCG1","DVCTLM2","DV42","DV4","TQ BLUE","DV KHAKHI2"];
  for (const name of powders) await prisma.roboPowder.upsert({ where: { name }, update: {}, create: { name } });

  // Designs + Programs
  const designData = [
    { name: "CALACATTA GOLD", programs: ["CALACATTA_GOLD_18_11_LESS_C1_3CM","CALACATTA GOLD FL","CALACATTA GOLD ZZ6_C2","CALACATTA GOLD ZZ6"] },
    { name: "BANYAN",         programs: ["BANYAN 2","BANYAN 2 FL","BANYAN 2 FINAL_C2"] },
    { name: "ATLANTIS",       programs: ["ATLANTIS TRIAL 8","ATLANTIS_FL","ATLANTIS_ROY3_ROY4_C2","ATLANTIS_ROY3_ROY4"] },
    { name: "AUREATE",        programs: [] },
    { name: "AMAZING SILVER", programs: [] },
    { name: "BELLAGIO",       programs: [] },
  ];
  for (const d of designData) {
    const design = await prisma.roboDesign.upsert({ where: { name: d.name }, update: {}, create: { name: d.name } });
    for (const p of d.programs) {
      await prisma.roboProgram.upsert({ where: { name: p }, update: {}, create: { name: p, designId: design.id } });
    }
  }

  // Delay Codes
  const delayCodes = [
    // ROYMIX
    { code:"RM1",  description:"Mixing (Mixing + Unload)",                                      category:"ROYMIX",      isRobotSpecific:false },
    { code:"RM2",  description:"Unload",                                                         category:"ROYMIX",      isRobotSpecific:false },
    { code:"RM3",  description:"Pigment Change",                                                 category:"ROYMIX",      isRobotSpecific:false },
    { code:"RM4",  description:"Grit / Filler Change",                                          category:"ROYMIX",      isRobotSpecific:false },
    { code:"RM5",  description:"Over Wetness",                                                   category:"ROYMIX",      isRobotSpecific:false },
    { code:"RM6",  description:"Over Dryness",                                                   category:"ROYMIX",      isRobotSpecific:false },
    { code:"RM7",  description:"Shade Checking",                                                 category:"ROYMIX",      isRobotSpecific:false },
    { code:"RM8",  description:"Resin / Grit / Filler",                                        category:"ROYMIX",      isRobotSpecific:false },
    { code:"RM9",  description:"Mixer Belt Emptying",                                           category:"ROYMIX",      isRobotSpecific:false },
    { code:"RM10", description:"Material Manually Added (Second Body)",                         category:"ROYMIX",      isRobotSpecific:false },
    { code:"RM11", description:"Roymixer Materials Added for Second Time by Roymix (Auto)",     category:"ROYMIX",      isRobotSpecific:false },
    { code:"RM12", description:"Roymixer Hopper Block",                                         category:"ROYMIX",      isRobotSpecific:false },
    // LINE
    { code:"L1",   description:"Production End",                                                category:"LINE",        isRobotSpecific:false },
    { code:"L2",   description:"Waiting for Slabs to be Polished",                             category:"LINE",        isRobotSpecific:false },
    { code:"L3",   description:"Line Acetone Cleaning",                                         category:"LINE",        isRobotSpecific:false },
    { code:"L4",   description:"Line Full Cleaning",                                            category:"LINE",        isRobotSpecific:false },
    { code:"L5",   description:"Program Change Required",                                       category:"LINE",        isRobotSpecific:false },
    { code:"L6",   description:"Stock Finished (Waiting to Receive Raw Materials)",            category:"LINE",        isRobotSpecific:false },
    // DISTRIBUTOR
    { code:"D1",   description:"Distributor Delays",                                            category:"DISTRIBUTOR", isRobotSpecific:false },
    { code:"D2",   description:"Wifi Connectivity",                                             category:"DISTRIBUTOR", isRobotSpecific:false },
    { code:"D3",   description:"Auxiliary Connection",                                          category:"DISTRIBUTOR", isRobotSpecific:false },
    { code:"D4",   description:"Material Manually Added to Slab",                              category:"DISTRIBUTOR", isRobotSpecific:false },
    // LINE START
    { code:"S1",   description:"Slab Reached at Robo",                                         category:"LINE_START",  isRobotSpecific:false },
    // PRESS
    { code:"P1",   description:"Press Delay",                                                   category:"PRESS",       isRobotSpecific:false },
    { code:"P2",   description:"Bypass Shuttle Alarm",                                          category:"PRESS",       isRobotSpecific:false },
    // MAINTENANCE (robot-specific)
    { code:"M1",   description:"Trolley Unusual Vibration / Jerking",                          category:"MAINTENANCE", isRobotSpecific:true },
    { code:"M2",   description:"Nozzle Cylinder Block",                                        category:"MAINTENANCE", isRobotSpecific:true },
    { code:"M3",   description:"Limit Switch Alarm",                                           category:"MAINTENANCE", isRobotSpecific:true },
    { code:"M4",   description:"Air Supply Failure",                                           category:"MAINTENANCE", isRobotSpecific:true },
    { code:"M5",   description:"Shutter Timeout Alarm",                                        category:"MAINTENANCE", isRobotSpecific:true },
    { code:"M6",   description:"7th Axis Alarm",                                               category:"MAINTENANCE", isRobotSpecific:true },
    { code:"M7",   description:"ARM1 Electric Stroke End",                                     category:"MAINTENANCE", isRobotSpecific:true },
    { code:"M8",   description:"Liquid - Gear 1 Pump Alarm",                                  category:"MAINTENANCE", isRobotSpecific:true },
    { code:"M9",   description:"Liquid - Gear 2 Pump Alarm",                                  category:"MAINTENANCE", isRobotSpecific:true },
    { code:"M10",  description:"Minimum Inlet / Outlet Pressure",                              category:"MAINTENANCE", isRobotSpecific:true },
    { code:"M11",  description:"Roy 1 Shuttle Alarm",                                          category:"MAINTENANCE", isRobotSpecific:true },
    { code:"M12",  description:"Frame Oil Pump",                                               category:"MAINTENANCE", isRobotSpecific:true },
    { code:"M13",  description:"Centering Problem",                                            category:"MAINTENANCE", isRobotSpecific:true },
    { code:"M14",  description:"Encoder Alarm",                                                category:"MAINTENANCE", isRobotSpecific:true },
    { code:"M15",  description:"Profinet Alarm",                                               category:"MAINTENANCE", isRobotSpecific:true },
    // ROBOT (robot-specific)
    { code:"C1",   description:"Frame Cleaning",                                               category:"ROBOT",       isRobotSpecific:true },
    { code:"C2",   description:"Liquid Nozzle / Circuit Block",                               category:"ROBOT",       isRobotSpecific:true },
    { code:"C3",   description:"Powder Nozzle Problem",                                       category:"ROBOT",       isRobotSpecific:true },
    { code:"C4",   description:"Tool Broken",                                                  category:"ROBOT",       isRobotSpecific:true },
    { code:"C5",   description:"Roller Adjustment (2cm to 3cm or 3cm to 2cm)",               category:"ROBOT",       isRobotSpecific:true },
    { code:"C6",   description:"Frame Oil Pump Alarm",                                        category:"ROBOT",       isRobotSpecific:true },
    { code:"C7",   description:"Vein Spillage Checking",                                      category:"ROBOT",       isRobotSpecific:true },
    { code:"C8",   description:"Tool Synchronisation",                                        category:"ROBOT",       isRobotSpecific:true },
    { code:"C9",   description:"Roymix Bowl Changing",                                        category:"ROBOT",       isRobotSpecific:true },
    { code:"C10",  description:"Bowl Dry Cleaning",                                           category:"ROBOT",       isRobotSpecific:true },
    { code:"C11",  description:"Bowl Sticker Applying",                                       category:"ROBOT",       isRobotSpecific:true },
    { code:"C12",  description:"Production Change Delay (Liq/Pow Changing)",                 category:"ROBOT",       isRobotSpecific:true },
    { code:"C13",  description:"Robo Run @ Slower Speed",                                     category:"ROBOT",       isRobotSpecific:true },
    { code:"C14",  description:"Tool Calibration",                                            category:"ROBOT",       isRobotSpecific:true },
    { code:"C15",  description:"Roymix Bowl & Spindle Checking",                              category:"ROBOT",       isRobotSpecific:true },
    // GENERAL (robot-specific)
    { code:"G1",   description:"Mould Alignment",                                             category:"GENERAL",     isRobotSpecific:true },
    { code:"G2",   description:"Waiting for Mould / Mould Delay",                            category:"GENERAL",     isRobotSpecific:true },
    { code:"G3",   description:"Pigment Issue - Viscosity / Colour (Shade)",                 category:"GENERAL",     isRobotSpecific:true },
    // POWERCUT
    { code:"T1",   description:"Powercut",                                                    category:"POWERCUT",    isRobotSpecific:false },
    { code:"T2",   description:"Profinet Alarm",                                              category:"POWERCUT",    isRobotSpecific:false },
    { code:"T3",   description:"Robos Operated with DG",                                     category:"POWERCUT",    isRobotSpecific:false },
    { code:"T4",   description:"Robo Key Tripped",                                            category:"POWERCUT",    isRobotSpecific:false },
  ];
  for (const dc of delayCodes) {
    await prisma.roboDelayCode.upsert({ where: { code: dc.code }, update: {}, create: dc });
  }

  console.log("Robo module seed complete.");
}

main().catch(console.error).finally(() => prisma.$disconnect());
