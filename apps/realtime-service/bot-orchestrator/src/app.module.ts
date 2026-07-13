import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { OrchestratorService } from './orchestrator/orchestrator.service';
import { KafkaService } from './kafka/kafka.service';
import { BotLauncherService } from './launcher/bot-launcher.service';
import { BotHealthMonitorService } from './orchestrator/bot-health-monitor.service';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [AppController],
  providers: [KafkaService, OrchestratorService, BotLauncherService, BotHealthMonitorService],
})
export class AppModule {}

