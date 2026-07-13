import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaClient } from '@prisma/client';
import { KafkaService } from '../kafka/kafka.service';
import { allocateBotAccount } from '@meetscribe/bot-pool';
import * as crypto from 'crypto';

@Injectable()
export class OrchestratorService {
  private readonly logger = new Logger(OrchestratorService.name);
  private readonly prisma = new PrismaClient();

  constructor(private readonly kafkaService: KafkaService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleCron() {
    this.logger.log('Polling for upcoming meetings...');
    
    const now = new Date();
    const threeMinutesFromNow = new Date(now.getTime() + 3 * 60 * 1000);

    try {
      // Dispatch meetings that fall into any of these buckets:
      // 1. No startTime set (join immediately / now)
      // 2. Starting within the next 3 minutes
      // 3. Already past startTime but never dispatched (orchestrator was down)
      const upcomingMeetings = await this.prisma.meeting.findMany({
        where: {
          status: 'SCHEDULED',
          OR: [
            { startTime: null },                          // join-now meetings
            { startTime: { lte: threeMinutesFromNow } },  // starting soon OR already past
          ],
        },
      });

      if (upcomingMeetings.length === 0) {
        this.logger.log('No upcoming meetings found.');
        return;
      }

      for (const meeting of upcomingMeetings) {
        // Generate a secure token for the bot to authenticate with the websocket later
        const botToken = crypto.randomBytes(32).toString('hex');

        let botAccountId: string | null = null;
        if (meeting.platform === 'MEET') {
          try {
            const botAccount = await allocateBotAccount(meeting.id);
            botAccountId = botAccount.id;
          } catch (err) {
            this.logger.error(`Failed to allocate bot account for meeting ${meeting.id}: ${(err as Error).message}`);
            // Skip this meeting for this run; it will be retried next minute
            continue;
          }
        }

        // Emit to Kafka
        await this.kafkaService.emit('dispatch.bot', {
          meetingId: meeting.id,
          platform: meeting.platform,
          meetingUrl: meeting.meetingUrl,
          botToken,
        });

        // Update status to ASSIGNED if MEET, or JOINING for other platforms
        const targetStatus = meeting.platform === 'MEET' ? 'ASSIGNED' : 'JOINING';
        await this.prisma.meeting.update({
          where: { id: meeting.id },
          data: { 
            status: targetStatus,
            botAccountId,
          },
        });

        // Upsert the Bot record (safe for re-dispatch scenarios)
        await this.prisma.bot.upsert({
          where: { meetingId: meeting.id },
          create: { meetingId: meeting.id, status: 'INITIALIZING' },
          update: { status: 'INITIALIZING', failureReason: null },
        });

        this.logger.log(`Dispatched bot for meeting ${meeting.id} (${meeting.platform})`);
      }
    } catch (error) {
      this.logger.error('Error processing upcoming meetings', error);
    }
  }
}
