import { Controller, Get, Param, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

@Controller('meetings')
export class MeetingsController {
  @Get(':id')
  async getMeetingStatus(@Param('id') id: string) {
    const meeting = await prisma.meeting.findUnique({
      where: { id },
      select: { status: true },
    });

    if (!meeting) throw new NotFoundException('Meeting not found');

    return { status: meeting.status };
  }
}
