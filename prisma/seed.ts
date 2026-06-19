import { PrismaClient, Role, FabRole } from "@prisma/client";
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
  { email: "cutter@thepacific.group",               name: "Cutter",   