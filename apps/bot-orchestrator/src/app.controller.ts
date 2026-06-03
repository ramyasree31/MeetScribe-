import { Controller, Get, Post, Body } from '@nestjs/common';
import { BotLauncherService } from './launcher/bot-launcher.service';

@Controller()
export class AppController {
  constructor(private readonly botLauncher: BotLauncherService) {}

  @Get('health')
  getHealth(): { status: string; timestamp: string } {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  @Post('dispatch')
  async dispatch(
    @Body()
    body: {
      meetingId: string;
      platform: string;
      meetingUrl: string;
      botToken: string;
      zoomPasscode?: string;
    },
  ) {
    // Avoid blocking the HTTP response by launching the container asynchronously
    this.botLauncher.launchBotContainer(body).catch(() => {});
    return { success: true };
  }
}
