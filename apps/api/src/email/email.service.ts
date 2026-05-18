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
    this.kafka = new Kafka({
      clientId: 'api-email-service',
      brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
    });
    
    // AWS credentials picked up automatically from environment
    this.ses = new SESClient({ region: process.env.AWS_REGION || 'us-east-1' });
  }

  async onModuleInit() {
    const consumer = this.kafka.consumer({ groupId: 'api-email-group' });
    await consumer.connect();
    await consumer.subscribe({ topic: 'summary.ready', fromBeginning: false });

    await consumer.run({
      eachMessage: async ({ message }) => {
        if (!message.value) return;
        try {
          const { meetingId, summaryId } = JSON.parse(message.value.toString());
          await this.sendMeetingSummaryEmail(meetingId, summaryId);
        } catch (error) {
          this.logger.error('Failed to process summary.ready for email', error);
        }
      },
    });
    
    this.logger.log('Email delivery service listening to Kafka');
  }

  private async sendMeetingSummaryEmail(meetingId: string, summaryId: string) {
    // 1. Fetch meeting and summary details
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      include: { 
        workspace: { include: { members: { include: { user: true } } } },
        summaries: { where: { id: summaryId } }
      }
    });

    if (!meeting || meeting.summaries.length === 0) return;

    const summary = meeting.summaries[0];
    const emails = meeting.workspace.members.map(m => m.user.email);

    if (emails.length === 0) return;

    // 2. Construct email HTML
    const htmlBody = `
      <h2>Meeting Summary: ${meeting.title}</h2>
      <h3>Overview</h3>
      <p>${summary.overview}</p>
      <hr />
      <h3>Action Items</h3>
      <ul>
        ${(summary.actionItems as any[]).map((i: any) => `<li><b>@${i.owner}</b>: ${i.task} (Due: ${i.dueDate})</li>`).join('')}
      </ul>
      <hr />
      <p>View the full details in your <a href="${process.env.FRONTEND_URL}/meetings/${meeting.id}/summary">Meeting Dashboard</a>.</p>
    `;

    // 3. Send via AWS SES
    const command = new SendEmailCommand({
      Source: process.env.EMAIL_FROM_ADDRESS || 'noreply@meetingbot.com',
      Destination: { ToAddresses: emails },
      Message: {
        Subject: { Data: `[Meeting Summary] ${meeting.title}` },
        Body: { Html: { Data: htmlBody } }
      }
    });

    await this.ses.send(command);
    this.logger.log(`Summary email sent to ${emails.length} participants for meeting ${meeting.id}`);
  }
}
