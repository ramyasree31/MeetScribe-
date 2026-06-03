import { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
export declare class KafkaService implements OnModuleInit, OnModuleDestroy {
    private readonly logger;
    private kafka;
    private producer;
    constructor();
    onModuleInit(): Promise<void>;
    onModuleDestroy(): Promise<void>;
    emit(topic: string, message: any): Promise<void>;
}
