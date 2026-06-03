import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function run() {
  const users = await prisma.user.findMany();
  console.log("Users:", JSON.stringify(users, null, 2));
  await prisma.$disconnect();
}
run();
