"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const socket_io_1 = require("socket.io");
const http_1 = require("http");
const kafkajs_1 = require("kafkajs");
const supabase_js_1 = require("@supabase/supabase-js");
const dotenv = __importStar(require("dotenv"));
dotenv.config();
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const KAFKA_BROKERS = process.env.KAFKA_BROKERS || 'localhost:9092';
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET || '';
const supabase = (0, supabase_js_1.createClient)(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const httpServer = (0, http_1.createServer)();
const io = new socket_io_1.Server(httpServer, {
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
    }
    catch (err) {
        next(new Error('Authentication error'));
    }
});
io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id} (User: ${socket.data.user.id})`);
    socket.on('join_meeting', (meetingId) => {
        socket.join(meetingId);
        console.log(`Socket ${socket.id} joined meeting room: ${meetingId}`);
    });
    socket.on('leave_meeting', (meetingId) => {
        socket.leave(meetingId);
        console.log(`Socket ${socket.id} left meeting room: ${meetingId}`);
    });
    socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`);
    });
});
const kafkaConfig = {
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
const kafka = new kafkajs_1.Kafka(kafkaConfig);
const consumer = kafka.consumer({ groupId: 'websocket-group' });
async function startKafka() {
    await consumer.connect();
    await consumer.subscribe({ topic: 'transcript.segments', fromBeginning: false });
    await consumer.subscribe({ topic: 'summary.ready', fromBeginning: false });
    await consumer.run({
        eachMessage: async ({ topic, partition, message }) => {
            if (!message.value)
                return;
            try {
                const data = JSON.parse(message.value.toString());
                const meetingId = data.meetingId;
                if (!meetingId)
                    return;
                if (topic === 'transcript.segments') {
                    io.to(meetingId).emit('segment', data);
                }
                else if (topic === 'summary.ready') {
                    io.to(meetingId).emit('summary_ready', data);
                }
            }
            catch (e) {
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
