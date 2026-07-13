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
import * as Docker from 'dockerode';
const prisma = new PrismaClient();
let BotHealthMonitorService = (() => {
    let _classDecorators = [Injectable()];
    let _classDescriptor;
    let _classExtraInitializers = [];
    let _classThis;
    let _instanceExtraInitializers = [];
    let _monitorBotPoolHealth_decorators;
    var BotHealthMonitorService = class {
        static { _classThis = this; }
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
            _monitorBotPoolHealth_decorators = [Cron(CronExpression.EVERY_6_HOURS)];
            __esDecorate(this, null, _monitorBotPoolHealth_decorators, { kind: "method", name: "monitorBotPoolHealth", static: false, private: false, access: { has: obj => "monitorBotPoolHealth" in obj, get: obj => obj.monitorBotPoolHealth }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
            BotHealthMonitorService = _classThis = _classDescriptor.value;
            if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
            __runInitializers(_classThis, _classExtraInitializers);
        }
        logger = (__runInitializers(this, _instanceExtraInitializers), new Logger(BotHealthMonitorService.name));
        docker = new Docker();
        async monitorBotPoolHealth() {
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
                    }
                    else {
                        this.logger.warn(`Bot account ${bot.email} health check failed or expired (code: ${StatusCode})`);
                        await prisma.botAccount.update({
                            where: { id: bot.id },
                            data: {
                                status: 'SESSION_EXPIRED',
                            },
                        });
                    }
                }
                catch (err) {
                    this.logger.error(`Failed to run health check for ${bot.email}: ${err.message}`);
                }
            }
            this.logger.log('Bot pool health check cron finished.');
        }
    };
    return BotHealthMonitorService = _classThis;
})();
export { BotHealthMonitorService };
