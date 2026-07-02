import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { UsersController } from './users/users.controller';
import { MeetingsController } from './meetings/meetings.controller';
import { MeetingsService } from './meetings/meetings.service';
import { SummariesController } from './summaries/summaries.controller';
import { EmailService } from './email/email.service';
import { OauthModule } from './oauth/oauth.module';
import { CalendarModule } from './calendar/calendar.module';
import { WebhooksModule } from './webhooks/webhooks.module';

@Module({
  imports: [OauthModule, CalendarModule, WebhooksModule],
  controllers: [AppController, UsersController, MeetingsController, SummariesController],
  providers: [MeetingsService, EmailService],
})
export class AppModule {}

