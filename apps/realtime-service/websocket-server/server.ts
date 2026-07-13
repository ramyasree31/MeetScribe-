import { Server } from 'socket.io';
import { createServer } from 'http';
import { Kafka } from 'kafkajs';
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken'; // Assuming we verify manually or use supabase helper
import * as dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const KAFKA_BROKERS = process.env.KAFKA_BROKERS || 'localhost:9092';
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: {
    origin: '*',
  },
});

io.use(async (socket, next) => {
  // Bypass auth completely for testing:
  socket.data.user = { id: '9acb7070-d837-4df0-a97e-d2162f357736' };
  next();
});

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id} (User: ${socket.data.user.id})`);

  socket.on('join_meeting', (meetingId: string) => {
    socket.join(meetingId);
    console.log(`Socket ${socket.id} joined meeting room: ${meetingId}`);
  });

  socket.on('leave_meeting', (meetingId: string) => {
    socket.leave(meetingId);
    console.log(`Socket ${socket.id} left meeting room: ${meetingId}`);
  });

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

const kafkaConfig: any = {
  clientId: 'websocket-server',
  brokers: KAFKA_BROKERS.split(','),
};

if (process.env.KAFKA_SASL_USERNAME && process.env.KAFKA_SASL_PASSWORD) {
  kafkaConfig.ssl = true;
  kafkaConfig.sasl = {
    mechanism: (process.env.KAFKA_SASL_MECHANISM || 'scram-sha-256').toLowerCase(),
    username: process.env.KAFKA_SASL_USERNAME,
    password: process.env.KAFKA_SASL_PASSWORD,
  };
}

const kafka = new Kafka(kafkaConfig);

const consumer = kafka.consumer({ groupId: 'websocket-group' });

async function startKafka() {
  await consumer.connect();
  await consumer.subscribe({ topic: 'transcript.segments', fromBeginning: false });
  await consumer.subscribe({ topic: 'summary.ready', fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      if (!message.value) return;
      
      try {
        const data = JSON.parse(message.value.toString());
        const meetingId = data.meetingId;
        
        if (!meetingId) return;

        if (topic === 'transcript.segments') {
          io.to(meetingId).emit('segment', data);
        } else if (topic === 'summary.ready') {
          io.to(meetingId).emit('summary_ready', data);
        }
      } catch (e) {
        console.error('Failed to process Kafka message', e);
      }
    },
  });
}

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`WebSocket server running on port ${PORT}`);
  startKafka().catch(console.error);
});
