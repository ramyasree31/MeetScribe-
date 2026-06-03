import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { MeetingsService, CreateMeetingDto } from './meetings.service';

@Controller('meetings')
@UseGuards(SupabaseAuthGuard)
export class MeetingsController {
  constructor(private readonly meetingsService: MeetingsService) {}

  /** POST /meetings — schedule a new meeting */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Req() req: any, @Body() dto: CreateMeetingDto) {
    return this.meetingsService.create(req.supabaseUser.id, dto);
  }

  /** GET /meetings — list all meetings for authenticated user */
  @Get()
  async findAll(@Req() req: any) {
    return this.meetingsService.findAll(req.supabaseUser.id);
  }

  /** GET /meetings/:id — get single meeting with full details */
  @Get(':id')
  async findOne(@Req() req: any, @Param('id') id: string) {
    return this.meetingsService.findOne(id, req.supabaseUser.id);
  }

  /** DELETE /meetings/:id — cancel a scheduled meeting */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(@Req() req: any, @Param('id') id: string) {
    return this.meetingsService.remove(id, req.supabaseUser.id);
  }

  /** POST /meetings/:id/dispatch — immediately send bot to a meeting */
  @Post(':id/dispatch')
  @HttpCode(HttpStatus.OK)
  async dispatch(@Req() req: any, @Param('id') id: string) {
    return this.meetingsService.dispatchBot(id, req.supabaseUser.id);
  }
}

