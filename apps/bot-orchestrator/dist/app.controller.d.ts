import { BotLauncherService } from './launcher/bot-launcher.service';
export declare class AppController {
    private readonly botLauncher;
    constructor(botLauncher: BotLauncherService);
    getHealth(): {
        status: string;
        timestamp: string;
    };
    dispatch(body: {
        meetingId: string;
        platform: string;
        meetingUrl: string;
        botToken: string;
        zoomPasscode?: string;
    }): Promise<{
        success: boolean;
    }>;
}
