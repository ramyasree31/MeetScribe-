"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const kafkajs_1 = require("kafkajs");
const dotenv = require("dotenv");
const path = require("path");
dotenv.config({ path: path.join(__dirname, '../.env') });
const prisma = new client_1.PrismaClient();
async function run() {
    console.log('Connecting to Kafka...');
    const kafka = new kafkajs_1.Kafka({
        clientId: 'test-dispatcher',
        brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
    });
    const producer = kafka.producer();
    await producer.connect();
    console.log('Kafka Producer connected.');
    console.log('Fetching/Creating user in DB...');
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
    const meetingUrl = 'https://meet.google.com/cfh-sitf-umt';
    console.log('Creating/Updating Meeting in DB...');
    const meeting = await prisma.meeting.create({
        data: {
            title: 'Automated Dispatch Test Meeting',
            platform: 'MEET',
            meetingUrl: meetingUrl,
            status: 'SCHEDULED',
            userId: user.id,
        },
    });
    console.log(`Created Meeting: ${meeting.title} (${meeting.id})`);
    const bot = await prisma.bot.create({
        data: {
            meetingId: meeting.id,
            status: 'INITIALIZING',
        },
    });
    console.log(`Created Bot record: ${bot.id}`);
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
//# sourceMappingURL=test-dispatch.js.map