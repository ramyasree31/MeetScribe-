export declare class UsersController {
    syncUser(req: any, body: {
        name?: string;
        avatarUrl?: string;
    }): Promise<{
        success: boolean;
        user: {
            id: string;
            supabaseId: string;
            email: string;
            name: string | null;
            avatarUrl: string | null;
            createdAt: Date;
            updatedAt: Date;
        };
    }>;
}
