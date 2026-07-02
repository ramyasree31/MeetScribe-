import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Kafka } from 'kafkajs';
import * as crypto from 'crypto';
import { allocateBotAccount } from '@meetscribe/bot-pool';

export interface CreateMeetingDto {
  title: string;
  platform: 'MEET' | 'ZOOM' | 'TEAMS';
  meetingUrl: string;
  startTime?: string; // ISO 8601
}

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

@Injectable()
export class MeetingsService {
  /**
   * Create a new scheduled meeting for a user.
   * The bot-orchestrator cron will pick this up when startTime approaches.
   */
  async create(supabaseId: string, dto: CreateMeetingDto) {
    // Resolve our internal user record from the Supabase user id
    const user = await prisma.user.findUnique({ where: { supabaseId } });
    if (!user) throw new NotFoundException('User not found — sync your account first');

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
  async findAll(supabaseId: string) {
    const user = await prisma.user.findUnique({ where: { supabaseId } });
    if (!user) throw new NotFoundException('User not found');

    return prisma.meeting.findMany({
      where: { userId: user.id },
      include: { summary: true, bot: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Get a single meeting with full details. */
  async findOne(id: string, supabaseId: string) {
    const user = await prisma.user.findUnique({ where: { supabaseId } });
    if (!user) throw new NotFoundException('User not found');

    const meeting = await prisma.meeting.findFirst({
      where: { id, userId: user.id },
      include: { summary: true, transcript: true, bot: true },
    });

    if (!meeting) throw new NotFoundException('Meeting not found');
    return meeting;
  }

  /** Delete a scheduled meeting (only if not already started). */
  async remove(id: string, supabaseId: string) {
    const user = await prisma.user.findUnique({ where: { supabaseId } });
    if (!user) throw new NotFoundException('User not found');

    const meeting = await prisma.meeting.findFirst({
      where: { id, userId: user.id },
    });

    if (!meeting) throw new NotFoundException('Meeting not found');

    await prisma.meeting.delete({ where: { id } });
    return { success: true };
  }

  /**
   * Immediately dispatch the bot for a meeting without waiting for the cron.
   * Only works for SCHEDULED or ERROR (retry) meetings.
   */
  async dispatchBot(id: string, supabaseId: string) {
    const user = await prisma.user.findUnique({ where: { supabaseId } });
    if (!user) throw new NotFoundException('User not found');

    const meeting = await prisma.meeting.findFirst({
      where: { id, userId: user.id },
    });
    if (!meeting) throw new NotFoundException('Meeting not found');

    if (!['SCHEDULED', 'ERROR', 'FAILED', 'JOINING'].includes(meeting.status)) {
      throw new BadRequestException(`Cannot dispatch bot — meeting status is ${meeting.status}`);
    }

    const botToken = crypto.randomBytes(32).toString('hex');

    let botAccountId: string | null = null;
    if (meeting.platform === 'MEET') {
      try {
        const botAccount = await allocateBotAccount(meeting.id);
        botAccountId = botAccount.id;
      } catch (err) {
        throw new BadRequestException(`Failed to allocate bot account: ${(err as Error).message}`);
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
}

