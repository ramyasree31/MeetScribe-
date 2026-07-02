import { Controller, Post, Headers, HttpCode, HttpStatus } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post('google-calendar')
  @HttpCode(HttpStatus.OK)
  async handleGoogleCalendar(
    @Headers('x-goog-channel-id') channelId: string,
    @Headers('x-goog-resource-id') resourceId: string,
    @Headers('x-goog-resource-state') state: string
  ) {
    if (state === 'sync') {
      console.log(`[Webhooks] Received sync confirmation for channel: ${channelId}`);
      return { success: true };
    }

    if (!channelId || !resourceId) {
      return { success: false, reason: 'missing_headers' };
    }

    return this.webhooksService.handleGoogleCalendarWebhook(channelId, resourceId);
  }
}
