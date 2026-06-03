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
var OrchestratorService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrchestratorService = void 0;
const common_1 = require("@nestjs/common");
const schedule_1 = require("@nestjs/schedule");
const client_1 = require("@prisma/client");
const kafka_service_1 = require("../kafka/kafka.service");
const crypto = require("crypto");
let OrchestratorService = OrchestratorService_1 = class OrchestratorService {
    constructor(kafkaService) {
        this.kafkaService = kafkaService;
        this.logger = new common_1.Logger(OrchestratorService_1.name);
        this.prisma = new client_1.PrismaClient();
    }
    async handleCron() {
        this.logger.log('Polling for upcoming meetings...');
        const now = new Date();
        const threeMinutesFromNow = new Date(now.getTime() + 3 * 60 * 1000);
        try {
            const upcomingMeetings = await this.prisma.meeting.findMany({
                where: {
                    status: 'SCHEDULED',
                    OR: [
                        { startTime: null },
                        { startTime: { lte: threeMinutesFromNow } },
                    ],
                },
            });
            if (upcomingMeetings.length === 0) {
                this.logger.log('No upcoming meetings found.');
                return;
            }
            for (const meeting of upcomingMeetings) {
                const botToken = crypto.randomBytes(32).toString('hex');
                await this.kafkaService.emit('dispatch.bot', {
                    meetingId: meeting.id,
                    platform: meeting.platform,
                    meetingUrl: meeting.meetingUrl,
                    botToken,
                });
                await this.prisma.meeting.update({
                    where: { id: meeting.id },
                    data: { status: 'JOINING' },
                });
                await this.prisma.bot.upsert({
                    where: { meetingId: meeting.id },
                    create: { meetingId: meeting.id, status: 'INITIALIZING' },
                    update: { status: 'INITIALIZING', errorMsg: null },
                });
                this.logger.log(`Dispatched bot for meeting ${meeting.id} (${meeting.platform})`);
            }
        }
        catch (error) {
            this.logger.error('Error processing upcoming meetings', error);
        }
    }
};
exports.OrchestratorService = OrchestratorService;
__decorate([
    (0, schedule_1.Cron)(schedule_1.CronExpression.EVERY_MINUTE),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], OrchestratorService.prototype, "handleCron", null);
exports.OrchestratorService = OrchestratorService = OrchestratorService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [kafka_service_1.KafkaService])
], OrchestratorService);
//# sourceMappingURL=orchestrator.service.js.map