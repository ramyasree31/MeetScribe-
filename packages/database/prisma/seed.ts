import { PrismaClient } from '@prisma/client';
import path from 'path';

const prisma = new PrismaClient();

// Docker containers mount ./profiles as /app/profiles.
// Locally, bot-launcher.service.ts remaps /app/profiles/* → <project>/profiles/*
// so we always store the Docker-canonical path here.
const bots = [
  { email: 'meetingbot001@gmail.com', profilePath: '/app/profiles/bot001' },
  { email: 'meetingbot002@gmail.com', profilePath: '/app/profiles/bot002' },
  { email: 'meetingbot003@gmail.com', profilePath: '/app/profiles/bot003' },
];

async function main() {
  console.log('Seeding bot accounts...');

  for (const bot of bots) {
    const record = await prisma.botAccount.upsert({
      where: { email: bot.email },
      update: { profilePath: bot.profilePath },
      create: {
        email: bot.email,
        profilePath: bot.profilePath,
        status: 'AVAILABLE',
      },
    });
    console.log(`- Upserted: ${record.email} → ${record.profilePath}`);
  }

  console.log('\nSeeding complete.');
  console.log('\nNext: authenticate each bot profile by running:');
  bots.forEach((_, i) => {
    const id = `bot00${i + 1}`;
    console.log(`  npx ts-node scripts/authenticate-bot-profile.ts ${id}`);
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
