import { Module } from '@nestjs/common';
import { ArbitrationService } from './arbitration.service';
import { ArbitrationJobService } from './arbitrationJob.service';

@Module({
  controllers: [],
  providers: [ArbitrationJobService, ArbitrationService],
  exports: [],
  imports: [],
})
export class ArbitrationModule { }
