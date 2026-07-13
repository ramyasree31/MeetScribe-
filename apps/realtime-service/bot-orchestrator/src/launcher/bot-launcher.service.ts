import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { Kafka, Consumer } from 'kafkajs';
import Docker = require('dockerode');
import { PrismaClient } from '@prisma/client';
import { spawn } from 'child_process';
import * as path from 'path';
import { releaseBotAccount } from '@meetscribe/bot-pool';

interface DispatchBotPayload {
  meetingId: string;
  platform: string;
  meetingUrl: string;
  botToken: string;
  zoomPasscode?: string;
}

@Injectable()
export class BotLauncherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BotLauncherService.name);
  private kafka: Kafka;
  private consumer: Consumer;
  private docker: Docker;
  private prisma = new PrismaClient();

  constructor() {
    const kafkaConfig: any = {
      clientId: 'bot-launcher',
      brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
    };

    if (process.env.KAFKA_SASL_USERNAME && process.env.KAFKA_SASL_PASSWORD) {
      kafkaConfig.ssl = true;
      kafkaConfig.sasl = {
        mechanism: (process.env.KAFKA_SASL_MECHANISM || 'scram-sha-256').toLowerCase(),
        username: process.env.KAFKA_SASL_USERNAME,
        password: process.env.KAFKA_SASL_PASSWORD,
      };
    }

    this.kafka = new Kafka(kafkaConfig);
    this.consumer = this.kafka.consumer({ groupId: 'bot-launcher-group' });

    // Dockerode auto-connects to the Docker socket
    // On Linux/Mac: /var/run/docker.sock
    // On Windows with Docker Desktop: npipe:////./pipe/docker_engine
    this.docker = new Docker();
  }

  async onModuleInit() {
    try {
      await this.consumer.connect();
      await this.consumer.subscribe({ topic: 'dispatch.bot', fromBeginning: false });

      await this.consumer.run({
        eachMessage: async ({ message }) => {
          if (!message.value) return;
          try {
            const payload: DispatchBotPayload = JSON.parse(message.value.toString());
            await this.launchBotContainer(payload);
          } catch (err) {
            this.logger.error('Failed to process dispatch.bot message', err);
          }
        },
      });

      this.logger.log('Bot launcher consumer ready — listening to dispatch.bot');
    } catch (err: any) {
      this.logger.warn(
        `Bot launcher: Kafka unavailable (${err?.message ?? err}). Bot containers won't be launched automatically.`,
      );
    }
  }

  async onModuleDestroy() {
    await this.consumer.disconnect();
  }

  async launchBotContainer(payload: DispatchBotPayload) {
    const { meetingId, meetingUrl, botToken, zoomPasscode } = payload;

    // Auto-detect platform from meeting URL if not explicitly provided
    const platform = payload.platform?.toUpperCase() || detectPlatform(meetingUrl);

    this.logger.log(`Launching ${platform} bot for meeting ${meetingId}`);

    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      include: { botAccount: true },
    });

    // Skip stale Kafka messages for meetings already in a terminal or active state
    const skipStatuses = ['FAILED', 'ERROR', 'LIVE', 'FINISHED', 'CANCELLED'];
    if (meeting && skipStatuses.includes(meeting.status)) {
      this.logger.warn(`Skipping stale dispatch for meeting ${meetingId} (status: ${meeting.status})`);
      return;
    }

    const BOT_IMAGE = process.env.BOT_WORKER_IMAGE || 'meetscribe/bot-worker:latest';

    const env: string[] = [
      `MEETING_ID=${meetingId}`,
      `MEETING_URL=${meetingUrl}`,
      `PLATFORM=${platform}`,
      `AUDIO_PROCESSOR_URL=${process.env.AUDIO_PROCESSOR_URL || 'ws://audio-processor:8001'}`,
      `BOT_TOKEN=${botToken}`,
      `KAFKA_BROKERS=${process.env.BOT_KAFKA_BROKERS || 'kafka:29092'}`,
      `BOT_NAME=${process.env.BOT_NAME || 'AI Notetaker'}`,
      `BOT_PROFILE_DIR=/app/profiles/bot001-fresh`,
    ];

    if (zoomPasscode) {
      env.push(`ZOOM_PASSCODE=${zoomPasscode}`);
    }

    // SKIP_DOCKER=true → run bot as local process instead of Docker container
    const skipDocker = process.env.SKIP_DOCKER === 'true';
    if (skipDocker) {
      this.logger.log(`SKIP_DOCKER=true — running bot locally (no Docker)`);
      await this.runLocalBot(payload, meeting);
      return;
    }

    try {
      try {
        const oldContainer = this.docker.getContainer(`bot-${meetingId}`);
        await oldContainer.remove({ force: true });
        this.logger.log(`Removed existing container bot-${meetingId} before recreating`);
      } catch (_) {}

      // Bind-mount the host profiles directory so the container can access
      const container = await this.docker.createContainer({
        Image: BOT_IMAGE,
        name: `bot-${meetingId}`,
        Tty: true,
        Env: env,
        HostConfig: {
          // Auto-remove container when it exits so we don't accumulate stopped containers
          AutoRemove: false,
          // Network so container can reach audio-processor, kafka, etc.
          NetworkMode: process.env.DOCKER_NETWORK || 'meetingbot_default',
          // Shared memory size for Chromium
          ShmSize: 256 * 1024 * 1024, // 256MB
          Binds: [`${process.env.BOT_PROFILES_BASE_DIR || '/profiles'}:/app/profiles`],
        },
      });

      await container.start();

      const containerId = container.id;
      this.logger.log(`Bot container started: ${containerId} for meeting ${meetingId}`);

      // Record the container ID in DB so we can track / kill it later
      await this.prisma.bot.upsert({
        where: { meetingId },
        create: {
          meetingId,
          status: 'JOINING',
          containerId,
        },
        update: {
          status: 'JOINING',
          containerId,
        },
      });

      // Update meeting status
      await this.prisma.meeting.update({
        where: { id: meetingId },
        data: { status: 'LIVE' },
      });

      // Watch for container exit in the background
      this.watchContainer(container, meetingId);
    } catch (err: any) {
      this.logger.error(`Failed to launch container for meeting ${meetingId}: ${err.message}. Trying local fallback...`);

      try {
        // __dirname is src/launcher (dev) or dist/launcher (prod).
        // Either way, 3 levels up reaches apps/, then bot-worker is a sibling.
        const botWorkerDir = path.resolve(__dirname, '../../../bot-worker');
        // Use node with compiled dist — avoids ts-node ESM conflicts in src/
        const cmd = process.execPath; // same node binary that is running this process

        const localEnv: any = {
          ...process.env,
          MEETING_ID: meetingId,
          MEETING_URL: meetingUrl,
          PLATFORM: platform,
          AUDIO_PROCESSOR_URL: 'ws://localhost:8001',
          BOT_TOKEN: botToken,
          KAFKA_BROKERS: process.env.KAFKA_BROKERS || 'localhost:9092',
          BOT_NAME: process.env.BOT_NAME || 'AI Notetaker',
        };
        if (zoomPasscode) {
          localEnv.ZOOM_PASSCODE = zoomPasscode;
        }

        const child = spawn(cmd, ['dist/index.js'], {
          cwd: botWorkerDir,
          env: localEnv,
          shell: false,
        });

        child.on('error', (err) => {
          this.logger.error(`Failed to spawn local bot worker process: ${err.message}`);
        });

        child.stdout?.on('data', (data) => {
          this.logger.log(`[local-bot-worker] ${data.toString().trim()}`);
        });

        child.stderr?.on('data', (data) => {
          this.logger.error(`[local-bot-worker-err] ${data.toString().trim()}`);
        });

        child.on('close', async (code) => {
          this.logger.log(`Local bot worker exited with code ${code}`);
          const finalStatus = code === 0 ? 'FINISHED' : 'ERROR';
          await this.prisma.bot.upsert({
            where: { meetingId },
            create: { meetingId, status: finalStatus },
            update: { status: finalStatus },
          }).catch(() => {});

          if (code !== 0) {
            await this.prisma.meeting.update({
              where: { id: meetingId },
              data: { status: 'FAILED' },
            }).catch(() => {});
          }

          // Release the bot account if allocated
          if (meeting?.botAccountId) {
            await releaseBotAccount(meeting.botAccountId, {
              failed: code !== 0,
              sessionExpired: code === 2,
            }).catch((releaseErr) => {
              this.logger.error(`Failed to release bot account: ${releaseErr.message}`);
            });
          }
        });

        // Record the local process in DB so it shows up in dashboard
        await this.prisma.bot.upsert({
          where: { meetingId },
          create: {
            meetingId,
            status: 'JOINING',
            containerId: 'local-process',
          },
          update: {
            status: 'JOINING',
            containerId: 'local-process',
          },
        });

        await this.prisma.meeting.update({
          where: { id: meetingId },
          data: { status: 'LIVE' },
        });

      } catch (fallbackErr: any) {
        this.logger.error(`Local fallback also failed: ${fallbackErr.message}`);

        await this.prisma.bot.upsert({
          where: { meetingId },
          create: {
            meetingId,
            status: 'ERROR',
            failureReason: `Docker: ${err.message}. Local: ${fallbackErr.message}`,
          },
          update: {
            status: 'ERROR',
            failureReason: `Docker: ${err.message}. Local: ${fallbackErr.message}`,
          },
        }).catch(() => {});

        await this.prisma.meeting.update({
          where: { id: meetingId },
          data: { status: 'FAILED' },
        }).catch(() => {});
      }
    }
  }

  async runLocalBot(
    payload: DispatchBotPayload,
    meeting: any,
  ) {
    const { meetingId, meetingUrl, botToken, zoomPasscode } = payload;
    const platform = payload.platform?.toUpperCase() || detectPlatform(meetingUrl);

    const botWorkerDir = path.resolve(__dirname, '../../../bot-worker');
    const cmd = process.execPath;

    const localEnv: any = {
      ...process.env,
      MEETING_ID: meetingId,
      MEETING_URL: meetingUrl,
      PLATFORM: platform,
      AUDIO_PROCESSOR_URL: 'ws://localhost:8001',
      BOT_TOKEN: botToken,
      KAFKA_BROKERS: process.env.KAFKA_BROKERS || 'localhost:9092',
      BOT_NAME: process.env.BOT_NAME || 'AI Notetaker',
    };
    if (zoomPasscode) {
      localEnv.ZOOM_PASSCODE = zoomPasscode;
    }

    const child = spawn(cmd, ['dist/index.js'], {
      cwd: botWorkerDir,
      env: localEnv,
      shell: false,
    });

    child.on('error', (err) => {
      this.logger.error(`Failed to spawn local bot worker: ${err.message}`);
    });
    child.stdout?.on('data', (data) => {
      this.logger.log(`[local-bot] ${data.toString().trim()}`);
    });
    child.stderr?.on('data', (data) => {
      this.logger.error(`[local-bot-err] ${data.toString().trim()}`);
    });
    child.on('close', async (code) => {
      this.logger.log(`Local bot exited with code ${code}`);
      const finalStatus = code === 0 ? 'FINISHED' : 'ERROR';
      await this.prisma.bot.upsert({
        where: { meetingId },
        create: { meetingId, status: finalStatus },
        update: { status: finalStatus },
      }).catch(() => {});
      if (code !== 0) {
        await this.prisma.meeting.update({
          where: { id: meetingId },
          data: { status: 'FAILED' },
        }).catch(() => {});
      }
      if (meeting?.botAccountId) {
        await releaseBotAccount(meeting.botAccountId, {
          failed: code !== 0,
          sessionExpired: code === 2,
        }).catch(() => {});
      }
    });

    await this.prisma.bot.upsert({
      where: { meetingId },
      create: { meetingId, status: 'JOINING', containerId: 'local-process' },
      update: { status: 'JOINING', containerId: 'local-process' },
    });
    await this.prisma.meeting.update({
      where: { id: meetingId },
      data: { status: 'LIVE' },
    });

    this.logger.log(`Local bot process spawned for meeting ${meetingId}`);
  }

  private watchContainer(container: Docker.Container, meetingId: string) {
    // docker.wait() resolves when the container stops
    container.wait().then(async ({ StatusCode }) => {
      this.logger.log(
        `Bot container for meeting ${meetingId} exited with code ${StatusCode}`,
      );

      const finalStatus = StatusCode === 0 ? 'FINISHED' : 'ERROR';
      let errorMsg = StatusCode !== 0 ? `Container exited with code ${StatusCode}` : null;

      if (StatusCode !== 0) {
        try {
          const logsBuffer = await container.logs({ stdout: true, stderr: true, tail: 15 });
          const logsText = logsBuffer.toString('utf8');
          if (logsText) {
            // Split by lines and clean
            const lines = logsText.split('\n').map(l => l.trim()).filter(Boolean);
            lines.reverse(); // Now index 0 is the last line
            // Search for an explicit error logged by our bot scripts
            const errorLine = lines.find(l => l.includes('Error:') || l.includes('Error '));
            if (errorLine) {
              // Extract the error message. e.g. "[meet-bot] Error: Private/restricted..." -> "Private/restricted..."
              const match = errorLine.match(/Error:\s*(.*)/i);
              if (match && match[1]) {
                errorMsg = match[1];
              } else {
                errorMsg = errorLine;
              }
            } else if (lines.length > 0) {
              // Fallback: take the last log line
              errorMsg = lines[0];
            }
          }
        } catch (logErr: any) {
          this.logger.error(`Failed to read container logs for error extraction: ${logErr.message}`);
        }
      }

      await this.prisma.bot.upsert({
        where: { meetingId },
        create: {
          meetingId,
          status: finalStatus,
          ...(errorMsg ? { failureReason: errorMsg } : {}),
        },
        update: {
          status: finalStatus,
          ...(errorMsg ? { failureReason: errorMsg } : {}),
        },
      }).catch(() => {});

      if (StatusCode !== 0) {
        await this.prisma.meeting.update({
          where: { id: meetingId },
          data: { status: 'FAILED' },
        }).catch(() => {});
      }

      // Query meeting to release bot account
      const meeting = await this.prisma.meeting.findUnique({
        where: { id: meetingId },
      });
      if (meeting && meeting.botAccountId) {
        await releaseBotAccount(meeting.botAccountId, {
          failed: StatusCode !== 0,
          sessionExpired: StatusCode === 2,
        }).catch((releaseErr) => {
          this.logger.error(`Failed to release bot account: ${releaseErr.message}`);
        });
      }
    }).catch((err) => {
      this.logger.error(`Error watching container for meeting ${meetingId}`, err);
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Platform detection helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Infer the meeting platform from the URL.
 * Falls back to 'MEET' (Google Meet) if no known domain is detected.
 */
function detectPlatform(meetingUrl: string): string {
  const url = (meetingUrl || '').toLowerCase();

  if (url.includes('zoom.us') || url.includes('zoom.com')) {
    return 'ZOOM';
  }
  if (
    url.includes('teams.microsoft.com') ||
    url.includes('teams.live.com') ||
    url.includes('teams.cloud.microsoft')
  ) {
    return 'TEAMS';
  }
  if (url.includes('webex.com') || url.includes('cisco.webex.com')) {
    return 'WEBEX';
  }
  if (url.includes('meet.google.com')) {
    return 'MEET';
  }

  // Default to Google Meet
  return 'MEET';
}
