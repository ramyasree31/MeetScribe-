import { Injectable, NotFoundException } from '@nestjs/common';
import { fullCalendarSync } from '@meetscribe/google-client';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

@Injectable()
export class CalendarService {
  async syncUserCalendar(supabaseId: string) {
    const user = await prisma.user.findUnique({ where: { supabaseId } });
    if (!user) throw new NotFoundException('User not found');

    const nextSyncToken = await fullCalendarSync(user.id);
    return { success: true, nextSyncToken };
  }
}
