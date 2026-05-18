import { Server } from 'socket.io';
import { createServer } from 'http';
import { Kafka } from 'kafkajs';
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken'; // Assuming we verify manually or use supabase helper

const SUPABASE_URL = process.env.SUPABASE_URL || '';
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
  try {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error('Authentication error: Missing token'));
    }

    // Verify JWT
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      return next(new Error('Authentication error: Invalid token'));
    }

    socket.data.user = user;
    next();
  } catch (err) {
    next(new Error('Authentication error'));
  }
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

const kafka = new Kafka({
  clientId: 'websocket-server',
  brokers: KAFKA_BROKERS.split(','),
});

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
