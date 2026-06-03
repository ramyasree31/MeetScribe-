import { Controller, Get, Param, NotFoundException, Req, UseGuards } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';

const prisma = new PrismaClient();

@Controller('summaries')
@UseGuards(SupabaseAuthGuard)
export class SummariesController {
  /** GET /summaries/:meetingId — fetch the AI summary for a meeting */
  @Get(':meetingId')
  async getSummary(@Param('meetingId') meetingId: string) {
    const summary = await prisma.summary.findUnique({
      where: { meetingId },
    });

    if (!summary) throw new NotFoundException('Summary not found');

    return summary;
  }
}

