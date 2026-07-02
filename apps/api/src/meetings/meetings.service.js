var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Kafka } from 'kafkajs';
import * as crypto from 'crypto';
import { allocateBotAccount } from '@meetscribe/bot-pool';
const prisma = new PrismaClient();
// Kafka producer — reused across calls
const kafka = new Kafka({
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
let MeetingsService = (() => {
    let _classDecorators = [Injectable()];
    let _classDescriptor;
    let _classExtraInitializers = [];
    let _classThis;
    var MeetingsService = class {
        static { _classThis = this; }
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
            __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
            MeetingsService = _classThis = _classDescriptor.value;
            if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
            __runInitializers(_classThis, _classExtraInitializers);
        }
        /**
         * Create a new scheduled meeting for a user.
         * The bot-orchestrator cron will pick this up when startTime approaches.
         */
        async create(supabaseId, dto) {
            // Resolve our internal user record from the Supabase user id
            const user = await prisma.user.findUnique({ where: { supabaseId } });
            if (!user)
                throw new NotFoundException('User not found — sync your account first');
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
        /** List all meetings for a user (newest first). */
        async findAll(supabaseId) {
            const user = await prisma.user.findUnique({ where: { supabaseId } });
            if (!user)
                throw new NotFoundException('User not found');
            return prisma.meeting.findMany({
                where: { userId: user.id },
                include: { summary: true, bot: true },
                orderBy: { createdAt: 'desc' },
            });
        }
        /** Get a single meeting with full details. */
        async findOne(id, supabaseId) {
            const user = await prisma.user.findUnique({ where: { supabaseId } });
            if (!user)
                throw new NotFoundException('User not found');
            const meeting = await prisma.meeting.findFirst({
                where: { id, userId: user.id },
                include: { summary: true, transcript: true, bot: true },
            });
            if (!meeting)
                throw new NotFoundException('Meeting not found');
            return meeting;
        }
        /** Delete a scheduled meeting (only if not already started). */
        async remove(id, supabaseId) {
            const user = await prisma.user.findUnique({ where: { supabaseId } });
            if (!user)
                throw new NotFoundException('User not found');
            const meeting = await prisma.meeting.findFirst({
                where: { id, userId: user.id },
            });
            if (!meeting)
                throw new NotFoundException('Meeting not found');
            await prisma.meeting.delete({ where: { id } });
            return { success: true };
        }
        /**
         * Immediately dispatch the bot for a meeting without waiting for the cron.
         * Only works for SCHEDULED or ERROR (retry) meetings.
         */
        async dispatchBot(id, supabaseId) {
            const user = await prisma.user.findUnique({ where: { supabaseId } });
            if (!user)
                throw new NotFoundException('User not found');
            const meeting = await prisma.meeting.findFirst({
                where: { id, userId: user.id },
            });
            if (!meeting)
                throw new NotFoundException('Meeting not found');
            if (!['SCHEDULED', 'ERROR', 'FAILED', 'JOINING'].includes(meeting.status)) {
                throw new BadRequestException(`Cannot dispatch bot — meeting status is ${meeting.status}`);
            }
            const botToken = crypto.randomBytes(32).toString('hex');
            let botAccountId = null;
            if (meeting.platform === 'MEET') {
                try {
                    const botAccount = await allocateBotAccount(meeting.id);
                    botAccountId = botAccount.id;
                }
                catch (err) {
                    throw new BadRequestException(`Failed to allocate bot account: ${err.message}`);
                }
            }
            // Emit to Kafka so the bot-launcher picks it up
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
            // Update meeting + bot status immediately
            const targetStatus = meeting.platform === 'MEET' ? 'ASSIGNED' : 'JOINING';
            await prisma.meeting.update({
                where: { id },
                data: {
                    status: targetStatus,
                    botAccountId,
                },
            });
            await prisma.bot.upsert({
                where: { meetingId: id },
                create: { meetingId: id, status: 'INITIALIZING' },
                update: { status: 'INITIALIZING', failureReason: null },
            });
            return { success: true, meetingId: id, status: targetStatus };
        }
    };
    return MeetingsService = _classThis;
})();
export { MeetingsService };
