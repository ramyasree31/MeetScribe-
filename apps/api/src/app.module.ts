import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { UsersController } from './users/users.controller';
import { MeetingsController } from './meetings/meetings.controller';
import { MeetingsService } from './meetings/meetings.service';
import { SummariesController } from './summaries/summaries.controller';
import { EmailService } from './email/email.service';

@Module({
  imports: [],
  controllers: [AppController, UsersController, MeetingsController, SummariesController],
  providers: [MeetingsService, EmailService],
})
export class AppModule {}

