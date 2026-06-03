export interface CreateMeetingDto {
    title: string;
    platform: 'MEET' | 'ZOOM' | 'TEAMS';
    meetingUrl: string;
    startTime?: string;
}
export declare class MeetingsService {
    create(supabaseId: string, dto: CreateMeetingDto): Promise<{
        id: string;
        title: string;
        platform: string;
        meetingUrl: string;
        status: string;
        startTime: Date | null;
        endTime: Date | null;
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        workspaceId: string | null;
    }>;
    findAll(supabaseId: string): Promise<({
        summary: {
            id: string;
            createdAt: Date;
            actionItems: import("@prisma/client/runtime/library").JsonValue;
            meetingId: string;
            overview: string;
            keyDecisions: import("@prisma/client/runtime/library").JsonValue;
            participants: import("@prisma/client/runtime/library").JsonValue;
        };
        bot: {
            id: string;
            status: string;
            createdAt: Date;
            updatedAt: Date;
            meetingId: string;
            containerId: string | null;
            errorMsg: string | null;
        };
    } & {
        id: string;
        title: string;
        platform: string;
        meetingUrl: string;
        status: string;
        startTime: Date | null;
        endTime: Date | null;
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        workspaceId: string | null;
    })[]>;
    findOne(id: string, supabaseId: string): Promise<{
        transcript: {
            id: string;
            createdAt: Date;
            meetingId: string;
            content: import("@prisma/client/runtime/library").JsonValue;
        };
        summary: {
            id: string;
            createdAt: Date;
            actionItems: import("@prisma/client/runtime/library").JsonValue;
            meetingId: string;
            overview: string;
            keyDecisions: import("@prisma/client/runtime/library").JsonValue;
            participants: import("@prisma/client/runtime/library").JsonValue;
        };
        bot: {
            id: string;
            status: string;
            createdAt: Date;
            updatedAt: Date;
            meetingId: string;
            containerId: string | null;
            errorMsg: string | null;
        };
    } & {
        id: string;
        title: string;
        platform: string;
        meetingUrl: string;
        status: string;
        startTime: Date | null;
        endTime: Date | null;
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        workspaceId: string | null;
    }>;
    remove(id: string, supabaseId: string): Promise<{
        success: boolean;
    }>;
    dispatchBot(id: string, supabaseId: string): Promise<{
        success: boolean;
        meetingId: string;
        status: string;
    }>;
}
