import { Injectable } from '@nestjs/common';
import { incrementalCalendarSync } from '@meetscribe/google-client';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

@Injectable()
export class WebhooksService {
  async handleGoogleCalendarWebhook(channelId: string, resourceId: string) {
    const watch = await prisma.calendarWatch.findUnique({
      where: { channelId },
    });

    if (!watch) {
      console.warn(`[Webhooks] Received Google Calendar webhook for unknown channel: ${channelId}`);
      return { success: false, reason: 'unknown_channel' };
    }

    if (watch.resourceId !== resourceId) {
      console.warn(
        `[Webhooks] Resource ID mismatch for channel ${channelId}: expected ${watch.resourceId}, got ${resourceId}`
      );
      return { success: false, reason: 'resource_mismatch' };
    }

    console.log(`[Webhooks] Triggering incremental calendar sync for user ID: ${watch.userId}`);

    const syncToken = watch.syncToken ?? '';

    try {
      await incrementalCalendarSync(watch.userId, syncToken);
      return { success: true };
    } catch (err) {
      console.error(`[Webhooks] Incremental sync failed for user ${watch.userId}:`, err);
      return { success: false, error: (err as Error).message };
    }
  }
}
