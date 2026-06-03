import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { Kafka, Consumer } from 'kafkajs';
import * as Docker from 'dockerode';
import { PrismaClient } from '@prisma/client';
import { spawn } from 'child_process';
import * as path from 'path';

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
      await this.consumer.subscribe({ topic: 'dispatch.bot', fromBeginning: true });

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

    const BOT_IMAGE = process.env.BOT_WORKER_IMAGE || 'meetscribe/bot-worker:latest';

    const env: string[] = [
      `MEETING_ID=${meetingId}`,
      `MEETING_URL=${meetingUrl}`,
      `PLATFORM=${platform}`,
      `AUDIO_PROCESSOR_URL=${process.env.AUDIO_PROCESSOR_URL || 'ws://audio-processor:8001'}`,
      `BOT_TOKEN=${botToken}`,
      // Bot-worker containers must use the internal Kafka listener (kafka:29092)
      // because 'localhost:9092' doesn't resolve inside a Docker container
      `KAFKA_BROKERS=${process.env.BOT_KAFKA_BROKERS || 'kafka:29092'}`,
      // Google Meet auth — pass cookie JSON through to bot container
      // Leave empty for guest-only mode; set to a JSON cookie array for authenticated joins
      `GOOGLE_COOKIES_JSON=${process.env.GOOGLE_COOKIES_JSON || ''}`,
      // Display name the bot uses in the meeting lobby
      `BOT_NAME=${process.env.BOT_NAME || 'AI Notetaker'}`,
    ];

    if (zoomPasscode) {
      env.push(`ZOOM_PASSCODE=${zoomPasscode}`);
    }

    try {
      try {
        const oldContainer = this.docker.getContainer(`bot-${meetingId}`);
        await oldContainer.remove({ force: true });
        this.logger.log(`Removed existing container bot-${meetingId} before recreating`);
      } catch (_) {}

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
        const botWorkerDir = path.resolve(__dirname, '../../../../bot-worker');
        const isWindows = process.platform === 'win32';
        const cmd = isWindows ? 'npx.cmd' : 'npx';

        const localEnv: any = {
          ...process.env,
          MEETING_ID: meetingId,
          MEETING_URL: meetingUrl,
          PLATFORM: platform,
          AUDIO_PROCESSOR_URL: 'ws://localhost:8001',
          BOT_TOKEN: botToken,
          KAFKA_BROKERS: process.env.KAFKA_BROKERS || 'localhost:9092',
          GOOGLE_COOKIES_JSON: process.env.GOOGLE_COOKIES_JSON || '',
          BOT_NAME: process.env.BOT_NAME || 'AI Notetaker',
        };
        if (zoomPasscode) {
          localEnv.ZOOM_PASSCODE = zoomPasscode;
        }

        const child = spawn(cmd, ['ts-node', 'src/index.ts'], {
          cwd: botWorkerDir,
          env: localEnv,
          shell: isWindows,
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
            errorMsg: `Docker: ${err.message}. Local: ${fallbackErr.message}`,
          },
          update: {
            status: 'ERROR',
            errorMsg: `Docker: ${err.message}. Local: ${fallbackErr.message}`,
          },
        }).catch(() => {});

        await this.prisma.meeting.update({
          where: { id: meetingId },
          data: { status: 'FAILED' },
        }).catch(() => {});
      }
    }
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
          ...(errorMsg ? { errorMsg } : {}),
        },
        update: {
          status: finalStatus,
          ...(errorMsg ? { errorMsg } : {}),
        },
      }).catch(() => {});

      if (StatusCode !== 0) {
        await this.prisma.meeting.update({
          where: { id: meetingId },
          data: { status: 'FAILED' },
        }).catch(() => {});
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
