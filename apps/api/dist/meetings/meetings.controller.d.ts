import { MeetingsService, CreateMeetingDto } from './meetings.service';
export declare class MeetingsController {
    private readonly meetingsService;
    constructor(meetingsService: MeetingsService);
    create(req: any, dto: CreateMeetingDto): Promise<{
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
    findAll(req: any): Promise<({
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
    findOne(req: any, id: string): Promise<{
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
    remove(req: any, id: string): Promise<{
        success: boolean;
    }>;
    dispatch(req: any, id: string): Promise<{
        success: boolean;
        meetingId: string;
        status: string;
    }>;
}
