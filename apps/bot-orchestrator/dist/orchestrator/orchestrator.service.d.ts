import { KafkaService } from '../kafka/kafka.service';
export declare class OrchestratorService {
    private readonly kafkaService;
    private readonly logger;
    private readonly prisma;
    constructor(kafkaService: KafkaService);
    handleCron(): Promise<void>;
}
