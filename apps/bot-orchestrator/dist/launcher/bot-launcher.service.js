"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var BotLauncherService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.BotLauncherService = void 0;
const common_1 = require("@nestjs/common");
const kafkajs_1 = require("kafkajs");
const Docker = require("dockerode");
const client_1 = require("@prisma/client");
const child_process_1 = require("child_process");
const path = require("path");
let BotLauncherService = BotLauncherService_1 = class BotLauncherService {
    constructor() {
        this.logger = new common_1.Logger(BotLauncherService_1.name);
        this.prisma = new client_1.PrismaClient();
        const kafkaConfig = {
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
        this.kafka = new kafkajs_1.Kafka(kafkaConfig);
        this.consumer = this.kafka.consumer({ groupId: 'bot-launcher-group' });
        this.docker = new Docker();
    }
    async onModuleInit() {
        try {
            await this.consumer.connect();
            await this.consumer.subscribe({ topic: 'dispatch.bot', fromBeginning: true });
            await this.consumer.run({
                eachMessage: async ({ message }) => {
                    if (!message.value)
                        return;
                    try {
                        const payload = JSON.parse(message.value.toString());
                        await this.launchBotContainer(payload);
                    }
                    catch (err) {
                        this.logger.error('Failed to process dispatch.bot message', err);
                    }
                },
            });
            this.logger.log('Bot launcher consumer ready — listening to dispatch.bot');
        }
        catch (err) {
            this.logger.warn(`Bot launcher: Kafka unavailable (${err?.message ?? err}). Bot containers won't be launched automatically.`);
        }
    }
    async onModuleDestroy() {
        await this.consumer.disconnect();
    }
    async launchBotContainer(payload) {
        const { meetingId, meetingUrl, botToken, zoomPasscode } = payload;
        const platform = payload.platform?.toUpperCase() || detectPlatform(meetingUrl);
        this.logger.log(`Launching ${platform} bot for meeting ${meetingId}`);
        const BOT_IMAGE = process.env.BOT_WORKER_IMAGE || 'meetscribe/bot-worker:latest';
        const env = [
            `MEETING_ID=${meetingId}`,
            `MEETING_URL=${meetingUrl}`,
            `PLATFORM=${platform}`,
            `AUDIO_PROCESSOR_URL=${process.env.AUDIO_PROCESSOR_URL || 'ws://audio-processor:8001'}`,
            `BOT_TOKEN=${botToken}`,
            `KAFKA_BROKERS=${process.env.BOT_KAFKA_BROKERS || 'kafka:29092'}`,
            `GOOGLE_COOKIES_JSON=${process.env.GOOGLE_COOKIES_JSON || ''}`,
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
            }
            catch (_) { }
            const container = await this.docker.createContainer({
                Image: BOT_IMAGE,
                name: `bot-${meetingId}`,
                Tty: true,
                Env: env,
                HostConfig: {
                    AutoRemove: false,
                    NetworkMode: process.env.DOCKER_NETWORK || 'meetingbot_default',
                    ShmSize: 256 * 1024 * 1024,
                },
            });
            await container.start();
            const containerId = container.id;
            this.logger.log(`Bot container started: ${containerId} for meeting ${meetingId}`);
            await this.prisma.bot.update({
                where: { meetingId },
                data: {
                    status: 'JOINING',
                    containerId,
                },
            });
            await this.prisma.meeting.update({
                where: { id: meetingId },
                data: { status: 'LIVE' },
            });
            this.watchContainer(container, meetingId);
        }
        catch (err) {
            this.logger.error(`Failed to launch container for meeting ${meetingId}: ${err.message}. Trying local fallback...`);
            try {
                const botWorkerDir = path.resolve(__dirname, '../../../../bot-worker');
                const isWindows = process.platform === 'win32';
                const cmd = isWindows ? 'npx.cmd' : 'npx';
                const localEnv = {
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
                const child = (0, child_process_1.spawn)(cmd, ['ts-node', 'src/index.ts'], {
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
                    await this.prisma.bot.update({
                        where: { meetingId },
                        data: { status: finalStatus },
                    }).catch(() => { });
                    if (code !== 0) {
                        await this.prisma.meeting.update({
                            where: { id: meetingId },
                            data: { status: 'FAILED' },
                        }).catch(() => { });
                    }
                });
                await this.prisma.bot.update({
                    where: { meetingId },
                    data: {
                        status: 'JOINING',
                        containerId: 'local-process',
                    },
                });
                await this.prisma.meeting.update({
                    where: { id: meetingId },
                    data: { status: 'LIVE' },
                });
            }
            catch (fallbackErr) {
                this.logger.error(`Local fallback also failed: ${fallbackErr.message}`);
                await this.prisma.bot.update({
                    where: { meetingId },
                    data: { status: 'ERROR', errorMsg: `Docker: ${err.message}. Local: ${fallbackErr.message}` },
                }).catch(() => { });
                await this.prisma.meeting.update({
                    where: { id: meetingId },
                    data: { status: 'FAILED' },
                }).catch(() => { });
            }
        }
    }
    watchContainer(container, meetingId) {
        container.wait().then(async ({ StatusCode }) => {
            this.logger.log(`Bot container for meeting ${meetingId} exited with code ${StatusCode}`);
            const finalStatus = StatusCode === 0 ? 'FINISHED' : 'ERROR';
            let errorMsg = StatusCode !== 0 ? `Container exited with code ${StatusCode}` : null;
            if (StatusCode !== 0) {
                try {
                    const logsBuffer = await container.logs({ stdout: true, stderr: true, tail: 15 });
                    const logsText = logsBuffer.toString('utf8');
                    if (logsText) {
                        const lines = logsText.split('\n').map(l => l.trim()).filter(Boolean);
                        lines.reverse();
                        const errorLine = lines.find(l => l.includes('Error:') || l.includes('Error '));
                        if (errorLine) {
                            const match = errorLine.match(/Error:\s*(.*)/i);
                            if (match && match[1]) {
                                errorMsg = match[1];
                            }
                            else {
                                errorMsg = errorLine;
                            }
                        }
                        else if (lines.length > 0) {
                            errorMsg = lines[0];
                        }
                    }
                }
                catch (logErr) {
                    this.logger.error(`Failed to read container logs for error extraction: ${logErr.message}`);
                }
            }
            await this.prisma.bot.update({
                where: { meetingId },
                data: {
                    status: finalStatus,
                    ...(errorMsg ? { errorMsg } : {}),
                },
            }).catch(() => { });
            if (StatusCode !== 0) {
                await this.prisma.meeting.update({
                    where: { id: meetingId },
                    data: { status: 'FAILED' },
                }).catch(() => { });
            }
        }).catch((err) => {
            this.logger.error(`Error watching container for meeting ${meetingId}`, err);
        });
    }
};
exports.BotLauncherService = BotLauncherService;
exports.BotLauncherService = BotLauncherService = BotLauncherService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], BotLauncherService);
function detectPlatform(meetingUrl) {
    const url = (meetingUrl || '').toLowerCase();
    if (url.includes('zoom.us') || url.includes('zoom.com')) {
        return 'ZOOM';
    }
    if (url.includes('teams.microsoft.com') ||
        url.includes('teams.live.com') ||
        url.includes('teams.cloud.microsoft')) {
        return 'TEAMS';
    }
    if (url.includes('webex.com') || url.includes('cisco.webex.com')) {
        return 'WEBEX';
    }
    if (url.includes('meet.google.com')) {
        return 'MEET';
    }
    return 'MEET';
}
//# sourceMappingURL=bot-launcher.service.js.map