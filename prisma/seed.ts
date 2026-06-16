import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL || "admin@thepacific.group";
  const password = process.env.SEED_ADMIN_PASSWORD || "changeme";
  const passwordHash = await bcrypt.hash(password, 10);

  const admin = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      name: "Administrator",
      passwordHash,
      role: Role.ADMIN,
    },
  });

  console.log(`Seeded admin user: ${admin.email} (role ${admin.role})`);
  console.log(`Password: ${password}  ← change this after first login`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
