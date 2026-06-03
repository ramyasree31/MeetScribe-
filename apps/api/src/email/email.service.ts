import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { Kafka } from 'kafkajs';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);
  private kafka: Kafka;
  private ses: SESClient;
  private prisma = new PrismaClient();

  constructor() {
    const kafkaConfig: any = {
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
          if (!message.value) return;
          try {
            const { meetingId } = JSON.parse(message.value.toString());
            await this.sendMeetingSummaryEmail(meetingId);
          } catch (error) {
            this.logger.error('Failed to process summary.ready for email', error);
          }
        },
      });

      this.logger.log('Email delivery service listening to Kafka');
    } catch (err: any) {
      // Kafka is optional — API runs fine without it (email just won't work)
      this.logger.warn(
        `Email service: Kafka unavailable (${err?.message ?? err}). Email notifications disabled.`,
      );
    }
  }

  private async sendMeetingSummaryEmail(meetingId: string) {
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

    if (!meeting || !meeting.summary) return;

    const summary = meeting.summary;

    // Collect recipient emails: workspace members OR just the meeting owner
    const emails: string[] =
      meeting.workspace?.members.map((m) => m.user.email) ?? [meeting.user.email];

    if (emails.length === 0) return;

    // 2. Construct email HTML
    const actionItems = (summary.actionItems as any[]) ?? [];
    const htmlBody = `
      <h2>Meeting Summary: ${meeting.title}</h2>
      <h3>Overview</h3>
      <p>${summary.overview}</p>
      <hr />
      <h3>Action Items</h3>
      <ul>
        ${actionItems
          .map(
            (i: any) =>
              `<li><b>@${i.owner}</b>: ${i.task} (Due: ${i.dueDate ?? 'TBD'})</li>`,
          )
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
    this.logger.log(
      `Summary email sent to ${emails.length} participant(s) for meeting ${meeting.id}`,
    );
  }
}

