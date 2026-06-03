import { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
interface DispatchBotPayload {
    meetingId: string;
    platform: string;
    meetingUrl: string;
    botToken: string;
    zoomPasscode?: string;
}
export declare class BotLauncherService implements OnModuleInit, OnModuleDestroy {
    private readonly logger;
    private kafka;
    private consumer;
    private docker;
    private prisma;
    constructor();
    onModuleInit(): Promise<void>;
    onModuleDestroy(): Promise<void>;
    launchBotContainer(payload: DispatchBotPayload): Promise<void>;
    private watchContainer;
}
export {};
