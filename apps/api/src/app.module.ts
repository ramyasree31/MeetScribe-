import { Module } from '@nestjs/common';
import { UsersController } from './users/users.controller';
import { MeetingsController } from './meetings/meetings.controller';
import { SummariesController } from './summaries/summaries.controller';
import { EmailService } from './email/email.service';

@Module({
  imports: [],
  controllers: [UsersController, MeetingsController, SummariesController],
  providers: [EmailService],
})
export class AppModule {}
