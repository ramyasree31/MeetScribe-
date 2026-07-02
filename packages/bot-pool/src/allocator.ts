import { PrismaClient, BotAccount } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Allocates an available BotAccount for the given meeting.
 * Uses a database transaction to prevent race conditions during concurrent requests.
 * Uses a least-recently-used (LRU) allocation strategy.
 */
export async function allocateBotAccount(meetingId: string): Promise<BotAccount> {
  return await prisma.$transaction(async (tx) => {
    // Find the least recently used BotAccount that is AVAILABLE and not in cooldown
    const bot = await tx.botAccount.findFirst({
      where: {
        status: 'AVAILABLE',
        OR: [
          { cooldownUntil: null },
          { cooldownUntil: { lt: new Date() } },
        ],
      },
      orderBy: {
        lastUsedAt: 'asc', // LRU order
      },
    });

    if (!bot) {
      throw new Error(`[BotPool] No available bot accounts for meeting ${meetingId}`);
    }

    // Update BotAccount status to BUSY and set lastUsedAt
    const updatedBot = await tx.botAccount.update({
      where: { id: bot.id },
      data: {
        status: 'BUSY',
        lastUsedAt: new Date(),
      },
    });

    // Update Meeting with the allocated bot account
    await tx.meeting.update({
      where: { id: meetingId },
      data: {
        botAccountId: bot.id,
      },
    });

    console.log(`[BotPool] Allocated bot account ${bot.email} (ID: ${bot.id}) for meeting ${meetingId}`);
    return updatedBot;
  });
}

export async function releaseBotAccount(
  botAccountId: string,
  options?: { failed?: boolean; sessionExpired?: boolean }
): Promise<void> {
  const bot = await prisma.botAccount.findUnique({
    where: { id: botAccountId },
  });

  if (!bot) {
    console.error(`[BotPool] Bot account with ID ${botAccountId} not found during release`);
    return;
  }

  const update: Partial<BotAccount> = {
    status: 'AVAILABLE',
  };

  if (options?.sessionExpired) {
    update.status = 'SESSION_EXPIRED';
    update.consecutiveFailures = bot.consecutiveFailures + 1;
    console.warn(`[BotPool] Bot account ${bot.email} session expired. Marking status as SESSION_EXPIRED.`);
  } else if (options?.failed) {
    const failures = bot.consecutiveFailures + 1;
    update.consecutiveFailures = failures;

    if (failures >= 3) {
      // Put in COOLDOWN for 30 minutes
      update.status = 'COOLDOWN';
      update.cooldownUntil = new Date(Date.now() + 30 * 60 * 1000);
      console.warn(`[BotPool] Bot account ${bot.email} reached 3 consecutive failures. Placing in COOLDOWN until ${update.cooldownUntil.toISOString()}`);
    } else {
      console.warn(`[BotPool] Bot account ${bot.email} failed. Consecutive failures: ${failures}`);
    }
  } else {
    // Reset consecutive failures on successful run
    update.consecutiveFailures = 0;
    console.log(`[BotPool] Bot account ${bot.email} released successfully. Reset consecutive failures.`);
  }

  await prisma.botAccount.update({
    where: { id: botAccountId },
    data: update,
  });
}
