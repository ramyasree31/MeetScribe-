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
var EmailService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmailService = void 0;
const common_1 = require("@nestjs/common");
const kafkajs_1 = require("kafkajs");
const client_ses_1 = require("@aws-sdk/client-ses");
const client_1 = require("@prisma/client");
let EmailService = EmailService_1 = class EmailService {
    constructor() {
        this.logger = new common_1.Logger(EmailService_1.name);
        this.prisma = new client_1.PrismaClient();
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
        this.kafka = new kafkajs_1.Kafka(kafkaConfig);
        this.ses = new client_ses_1.SESClient({ region: process.env.AWS_REGION || 'us-east-1' });
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
            this.logger.warn(`Email service: Kafka unavailable (${err?.message ?? err}). Email notifications disabled.`);
        }
    }
    async sendMeetingSummaryEmail(meetingId) {
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
        const emails = meeting.workspace?.members.map((m) => m.user.email) ?? [meeting.user.email];
        if (emails.length === 0)
            return;
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
        const command = new client_ses_1.SendEmailCommand({
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
exports.EmailService = EmailService;
exports.EmailService = EmailService = EmailService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], EmailService);
//# sourceMappingURL=email.service.js.map