const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
  try {
    const bots = await prisma.bot.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5
    });
    console.log(JSON.stringify(bots, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}
run();
