import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { OrchestratorService } from './orchestrator/orchestrator.service';
import { KafkaService } from './kafka/kafka.service';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [AppController],
  providers: [KafkaService, OrchestratorService],
})
export class AppModule {}
