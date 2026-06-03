"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.MeetingsService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const kafkajs_1 = require("kafkajs");
const crypto = __importStar(require("crypto"));
const prisma = new client_1.PrismaClient();
const kafka = new kafkajs_1.Kafka({
    clientId: 'api-gateway',
    brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
});
const producer = kafka.producer();
let producerConnected = false;
async function getProducer() {
    if (!producerConnected) {
        await producer.connect();
        producerConnected = true;
    }
    return producer;
}
let MeetingsService = class MeetingsService {
    async create(supabaseId, dto) {
        const user = await prisma.user.findUnique({ where: { supabaseId } });
        if (!user)
            throw new common_1.NotFoundException('User not found — sync your account first');
        const meeting = await prisma.meeting.create({
            data: {
                title: dto.title,
                platform: dto.platform,
                meetingUrl: dto.meetingUrl,
                status: 'SCHEDULED',
                startTime: dto.startTime ? new Date(dto.startTime) : null,
                userId: user.id,
            },
        });
        return meeting;
    }
    async findAll(supabaseId) {
        const user = await prisma.user.findUnique({ where: { supabaseId } });
        if (!user)
            throw new common_1.NotFoundException('User not found');
        return prisma.meeting.findMany({
            where: { userId: user.id },
            include: { summary: true, bot: true },
            orderBy: { createdAt: 'desc' },
        });
    }
    async findOne(id, supabaseId) {
        const user = await prisma.user.findUnique({ where: { supabaseId } });
        if (!user)
            throw new common_1.NotFoundException('User not found');
        const meeting = await prisma.meeting.findFirst({
            where: { id, userId: user.id },
            include: { summary: true, transcript: true, bot: true },
        });
        if (!meeting)
            throw new common_1.NotFoundException('Meeting not found');
        return meeting;
    }
    async remove(id, supabaseId) {
        const user = await prisma.user.findUnique({ where: { supabaseId } });
        if (!user)
            throw new common_1.NotFoundException('User not found');
        const meeting = await prisma.meeting.findFirst({
            where: { id, userId: user.id },
        });
        if (!meeting)
            throw new common_1.NotFoundException('Meeting not found');
        await prisma.meeting.delete({ where: { id } });
        return { success: true };
    }
    async dispatchBot(id, supabaseId) {
        const user = await prisma.user.findUnique({ where: { supabaseId } });
        if (!user)
            throw new common_1.NotFoundException('User not found');
        const meeting = await prisma.meeting.findFirst({
            where: { id, userId: user.id },
        });
        if (!meeting)
            throw new common_1.NotFoundException('Meeting not found');
        if (!['SCHEDULED', 'ERROR', 'FAILED', 'JOINING'].includes(meeting.status)) {
            throw new common_1.BadRequestException(`Cannot dispatch bot — meeting status is ${meeting.status}`);
        }
        const botToken = crypto.randomBytes(32).toString('hex');
        const prod = await getProducer();
        await prod.send({
            topic: 'dispatch.bot',
            messages: [{
                    value: JSON.stringify({
                        meetingId: meeting.id,
                        platform: meeting.platform,
                        meetingUrl: meeting.meetingUrl,
                        botToken,
                    }),
                }],
        });
        await prisma.meeting.update({
            where: { id },
            data: { status: 'JOINING' },
        });
        await prisma.bot.upsert({
            where: { meetingId: id },
            create: { meetingId: id, status: 'INITIALIZING' },
            update: { status: 'INITIALIZING', errorMsg: null },
        });
        return { success: true, meetingId: id, status: 'JOINING' };
    }
};
exports.MeetingsService = MeetingsService;
exports.MeetingsService = MeetingsService = __decorate([
    (0, common_1.Injectable)()
], MeetingsService);
//# sourceMappingURL=meetings.service.js.map