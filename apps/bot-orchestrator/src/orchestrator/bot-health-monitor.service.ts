import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaClient } from '@prisma/client';
import Docker = require('dockerode');

const prisma = new PrismaClient();

@Injectable()
export class BotHealthMonitorService {
  private readonly logger = new Logger(BotHealthMonitorService.name);
  private docker = new Docker();

  @Cron(CronExpression.EVERY_6_HOURS)
  async monitorBotPoolHealth() {
    if (process.env.SKIP_DOCKER === 'true') {
      this.logger.log('SKIP_DOCKER=true — skipping Docker-based health check');
      return;
    }
    this.logger.log('Starting bot pool health check cron...');

    const bots = await prisma.botAccount.findMany({
      where: {
        status: { not: 'RETIRED' },
      },
    });

    const BOT_IMAGE = process.env.BOT_WORKER_IMAGE || 'meetscribe/bot-worker:latest';

    for (const bot of bots) {
      this.logger.log(`Dispatching health-check container for: ${bot.email}`);

      try {
        const uniqueName = `health-check-${bot.id}-${Date.now()}`;
        const container = await this.docker.createContainer({
          Image: BOT_IMAGE,
          name: uniqueName,
          Tty: true,
          Env: [
            'HEALTH_CHECK=true',
            `BOT_PROFILE_DIR=${bot.profilePath}`,
          ],
          HostConfig: {
            AutoRemove: true,
            NetworkMode: process.env.DOCKER_NETWORK || 'meetingbot_default',
            ShmSize: 256 * 1024 * 1024,
            Binds: ['bot_profiles:/app/profiles'],
          },
        });

        await container.start();

        const waitResult = await container.wait();
        const StatusCode = waitResult.StatusCode;

        this.logger.log(`Health check container for ${bot.email} exited with code: ${StatusCode}`);

        if (StatusCode === 0) {
          this.logger.log(`Bot account ${bot.email} is HEALTHY`);
          await prisma.botAccount.update({
            where: { id: bot.id },
            data: {
              status: 'AVAILABLE',
              sessionValidAt: new Date(),
              consecutiveFailures: 0,
            },
          });
        } else {
          this.logger.warn(`Bot account ${bot.email} health check failed or expired (code: ${StatusCode})`);
          await prisma.botAccount.update({
            where: { id: bot.id },
            data: {
              status: 'SESSION_EXPIRED',
            },
          });
        }
      } catch (err: any) {
        this.logger.error(`Failed to run health check for ${bot.email}: ${err.message}`);
      }
    }

    this.logger.log('Bot pool health check cron finished.');
  }
}
