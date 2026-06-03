export declare class SummariesController {
    getSummary(meetingId: string): Promise<{
        id: string;
        createdAt: Date;
        actionItems: import("@prisma/client/runtime/library").JsonValue;
        meetingId: string;
        overview: string;
        keyDecisions: import("@prisma/client/runtime/library").JsonValue;
        participants: import("@prisma/client/runtime/library").JsonValue;
    }>;
}
