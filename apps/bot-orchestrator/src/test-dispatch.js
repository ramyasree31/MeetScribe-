import { PrismaClient } from '@prisma/client';
import { Kafka } from 'kafkajs';
import * as dotenv from 'dotenv';
import * as path from 'path';
// Load environment variables from the orchestrator's .env file
dotenv.config({ path: path.join(__dirname, '../.env') });
const prisma = new PrismaClient();
async function run() {
    console.log('Connecting to Kafka...');
    const kafka = new Kafka({
        clientId: 'test-dispatcher',
        brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
    });
    const producer = kafka.producer();
    await producer.connect();
    console.log('Kafka Producer connected.');
    console.log('Fetching/Creating user in DB...');
    // Find a user or create a test user
    let user = await prisma.user.findFirst();
    if (!user) {
        user = await prisma.user.create({
            data: {
                email: 'test@example.com',
                supabaseId: 'test-supabase-id-' + Math.random().toString(36).substring(7),
                name: 'Test User',
            },
        });
    }
    console.log(`Using User: ${user.email} (${user.id})`);
    // Define Google Meet URL
    const meetingUrl = 'https://meet.google.com/ogh-fnpi-ahn';
    console.log('Creating/Updating Meeting in DB...');
    // Create a new meeting
    const meeting = await prisma.meeting.create({
        data: {
            title: 'Live Test Meeting',
            platform: 'MEET',
            meetingUrl: meetingUrl,
            status: 'SCHEDULED',
            userId: user.id,
        },
    });
    console.log(`Created Meeting: ${meeting.title} (${meeting.id})`);
    // Create Bot record for the meeting
    const bot = await prisma.bot.create({
        data: {
            meetingId: meeting.id,
            status: 'INITIALIZING',
        },
    });
    console.log(`Created Bot record: ${bot.id}`);
    // Payload for Kafka message
    const payload = {
        meetingId: meeting.id,
        platform: 'MEET',
        meetingUrl: meetingUrl,
        botToken: 'mock-bot-token-' + Math.random().toString(36).substring(7),
    };
    console.log('Sending message to Kafka dispatch.bot...');
    await producer.send({
        topic: 'dispatch.bot',
        messages: [
            {
                value: JSON.stringify(payload),
            },
        ],
    });
    console.log('Event dispatched successfully! Payload:', payload);
    await producer.disconnect();
    await prisma.$disconnect();
}
run().catch((err) => {
    console.error('Failed to run dispatcher:', err);
    process.exit(1);
});
