import { Controller, Post, Req, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { CalendarService } from './calendar.service';

@Controller('calendar')
@UseGuards(SupabaseAuthGuard)
export class CalendarController {
  constructor(private readonly calendarService: CalendarService) {}

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  async syncCalendar(@Req() req: any) {
    return this.calendarService.syncUserCalendar(req.supabaseUser.id);
  }
}
