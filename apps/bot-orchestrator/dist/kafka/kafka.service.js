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
var KafkaService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.KafkaService = void 0;
const common_1 = require("@nestjs/common");
const kafkajs_1 = require("kafkajs");
let KafkaService = KafkaService_1 = class KafkaService {
    constructor() {
        this.logger = new common_1.Logger(KafkaService_1.name);
        const kafkaConfig = {
            clientId: 'bot-orchestrator',
            brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
            retry: {
                initialRetryTime: 100,
                retries: 8
            }
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
        this.producer = this.kafka.producer();
    }
    async onModuleInit() {
        try {
            await this.producer.connect();
            this.logger.log('Kafka Producer connected');
        }
        catch (err) {
            this.logger.warn(`Kafka unavailable on startup: ${err?.message ?? err}. Will retry on first emit.`);
        }
    }
    async onModuleDestroy() {
        await this.producer.disconnect();
        this.logger.log('Kafka Producer disconnected');
    }
    async emit(topic, message) {
        try {
            await this.producer.connect().catch(() => { });
            await this.producer.send({
                topic,
                messages: [{ value: JSON.stringify(message) }],
            });
            this.logger.log(`Message emitted to ${topic}`);
        }
        catch (err) {
            this.logger.error(`Failed to emit to Kafka topic ${topic}: ${err?.message ?? err}`);
            throw err;
        }
    }
};
exports.KafkaService = KafkaService;
exports.KafkaService = KafkaService = KafkaService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], KafkaService);
//# sourceMappingURL=kafka.service.js.map