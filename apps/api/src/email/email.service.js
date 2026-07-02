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
import { Injectable, Logger } from '@nestjs/common';
import { Kafka } from 'kafkajs';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { PrismaClient } from '@prisma/client';
let EmailService = (() => {
    let _classDecorators = [Injectable()];
    let _classDescriptor;
    let _classExtraInitializers = [];
    let _classThis;
    var EmailService = class {
        static { _classThis = this; }
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
            __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
            EmailService = _classThis = _classDescriptor.value;
            if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
            __runInitializers(_classThis, _classExtraInitializers);
        }
        logger = new Logger(EmailService.name);
        kafka;
        ses;
        prisma = new PrismaClient();
        constructor() {
            const kafkaConfig = {
                clientId: 'api-email-service',
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
            // AWS credentials picked up automatically from environment
            this.ses = new SESClient({ region: process.env.AWS_REGION || 'us-east-1' });
        }
        async onModuleInit() {
            try {
                const consumer = this.kafka.consumer({ groupId: 'api-email-group' });
                await consumer.connect();
                await consumer.subscribe({ topic: 'summary.ready', fromBeginning: false });
                await consumer.run({
                    eachMessage: async ({ message }) => {
                        if (!message.value)
                            return;
                        try {
                            const { meetingId } = JSON.parse(message.value.toString());
                            await this.sendMeetingSummaryEmail(meetingId);
                        }
                        catch (error) {
                            this.logger.error('Failed to process summary.ready for email', error);
                        }
                    },
                });
                this.logger.log('Email delivery service listening to Kafka');
            }
            catch (err) {
                // Kafka is optional — API runs fine without it (email just won't work)
                this.logger.warn(`Email service: Kafka unavailable (${err?.message ?? err}). Email notifications disabled.`);
            }
        }
        async sendMeetingSummaryEmail(meetingId) {
            // 1. Fetch meeting + summary + owner user
            const meeting = await this.prisma.meeting.findUnique({
                where: { id: meetingId },
                include: {
                    summary: true,
                    user: true,
                    workspace: {
                        include: {
                            members: { include: { user: true } },
                        },
                    },
                },
            });
            if (!meeting || !meeting.summary)
                return;
            const summary = meeting.summary;
            // Collect recipient emails: workspace members OR just the meeting owner
            const emails = meeting.workspace?.members.map((m) => m.user.email) ?? [meeting.user.email];
            if (emails.length === 0)
                return;
            // 2. Construct email HTML
            const actionItems = summary.actionItems ?? [];
            const htmlBody = `
      <h2>Meeting Summary: ${meeting.title}</h2>
      <h3>Overview</h3>
      <p>${summary.overview}</p>
      <hr />
      <h3>Action Items</h3>
      <ul>
        ${actionItems
                .map((i) => `<li><b>@${i.owner}</b>: ${i.task} (Due: ${i.dueDate ?? 'TBD'})</li>`)
                .join('')}
      </ul>
      <hr />
      <p>View the full details in your <a href="${process.env.FRONTEND_URL}/meetings/${meeting.id}">Meeting Dashboard</a>.</p>
    `;
            // 3. Send via AWS SES
            const command = new SendEmailCommand({
                Source: process.env.EMAIL_FROM_ADDRESS || 'noreply@meetingbot.com',
                Destination: { ToAddresses: emails },
                Message: {
                    Subject: { Data: `[Meeting Summary] ${meeting.title}` },
                    Body: { Html: { Data: htmlBody } },
                },
            });
            await this.ses.send(command);
            this.logger.log(`Summary email sent to ${emails.length} participant(s) for meeting ${meeting.id}`);
        }
    };
    return EmailService = _classThis;
})();
export { EmailService };
