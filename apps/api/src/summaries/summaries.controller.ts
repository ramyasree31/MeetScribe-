import { Controller, Get, Param, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

@Controller('summaries')
export class SummariesController {
  @Get(':id')
  async getSummary(@Param('id') id: string) {
    const summary = await prisma.summary.findUnique({
      where: { id },
    });

    if (!summary) throw new NotFoundException('Summary not found');

    return summary;
  }
}
