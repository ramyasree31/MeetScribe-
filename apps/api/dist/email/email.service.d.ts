import { OnModuleInit } from '@nestjs/common';
export declare class EmailService implements OnModuleInit {
    private readonly logger;
    private kafka;
    private ses;
    private prisma;
    constructor();
    onModuleInit(): Promise<void>;
    private sendMeetingSummaryEmail;
}
