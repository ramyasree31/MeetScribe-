var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
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
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaClient } from '@prisma/client';
import { allocateBotAccount } from '@meetscribe/bot-pool';
import * as crypto from 'crypto';
let OrchestratorService = (() => {
    let _classDecorators = [Injectable()];
    let _classDescriptor;
    let _classExtraInitializers = [];
    let _classThis;
    let _instanceExtraInitializers = [];
    let _handleCron_decorators;
    var OrchestratorService = class {
        static { _classThis = this; }
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
            _handleCron_decorators = [Cron(CronExpression.EVERY_MINUTE)];
            __esDecorate(this, null, _handleCron_decorators, { kind: "method", name: "handleCron", static: false, private: false, access: { has: obj => "handleCron" in obj, get: obj => obj.handleCron }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
            OrchestratorService = _classThis = _classDescriptor.value;
            if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
            __runInitializers(_classThis, _classExtraInitializers);
        }
        kafkaService = __runInitializers(this, _instanceExtraInitializers);
        logger = new Logger(OrchestratorService.name);
        prisma = new PrismaClient();
        constructor(kafkaService) {
            this.kafkaService = kafkaService;
        }
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
                            { startTime: null }, // join-now meetings
                            { startTime: { lte: threeMinutesFromNow } }, // starting soon OR already past
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
                    let botAccountId = null;
                    if (meeting.platform === 'MEET') {
                        try {
                            const botAccount = await allocateBotAccount(meeting.id);
                            botAccountId = botAccount.id;
                        }
                        catch (err) {
                            this.logger.error(`Failed to allocate bot account for meeting ${meeting.id}: ${err.message}`);
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
            }
            catch (error) {
                this.logger.error('Error processing upcoming meetings', error);
            }
        }
    };
    return OrchestratorService = _classThis;
})();
export { OrchestratorService };
