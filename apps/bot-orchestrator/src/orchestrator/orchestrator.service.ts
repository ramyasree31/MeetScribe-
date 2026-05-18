import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaClient } from '@prisma/client'; // Assuming generated in packages/database
import { KafkaService } from '../kafka/kafka.service';
import * as crypto from 'crypto';

@Injectable()
export class OrchestratorService {
  private readonly logger = new Logger(OrchestratorService.name);
  private readonly prisma = new PrismaClient(); // Typically injected via a PrismaService

  constructor(private readonly kafkaService: KafkaService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleCron() {
    this.logger.log('Polling for upcoming meetings...');
    
    const now = new Date();
    const threeMinutesFromNow = new Date(now.getTime() + 3 * 60 * 1000);

    try {
      const upcomingMeetings = await this.prisma.meeting.findMany({
        where: {
          status: 'SCHEDULED',
          startTime: {
            lte: threeMinutesFromNow,
            gte: now, // Optional: prevent joining meetings way in the past if worker was down
          },
        },
      });

      if (upcomingMeetings.length === 0) {
        this.logger.log('No upcoming meetings found.');
        return;
      }

      for (const meeting of upcomingMeetings) {
        // Generate a secure token for the bot to authenticate with the websocket later
        const botToken = crypto.randomBytes(32).toString('hex');

        // Emit to Kafka
        await this.kafkaService.emit('dispatch.bot', {
          meetingId: meeting.id,
          platform: meeting.platform,
          meetingUrl: meeting.meetingUrl,
          botToken,
        });

        // Update status to JOINING
        await this.prisma.meeting.update({
          where: { id: meeting.id },
          data: { status: 'JOINING' },
        });

        // Also create the Bot record to track this specific worker instance
        await this.prisma.bot.create({
          data: {
            meetingId: meeting.id,
            status: 'INITIALIZING',
          }
        });

        this.logger.log(`Dispatched bot for meeting ${meeting.id} (${meeting.platform})`);
      }
    } catch (error) {
      this.logger.error('Error processing upcoming meetings', error);
    }
  }
}
