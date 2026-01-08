/**
 * Planner 执行模块
 */

import { Module } from '@nestjs/common';
import { PlannerController } from './planner.controller';
import { PlannerService } from './planner.service';
import { ToolsModule } from '../tools/tools.module';

@Module({
  imports: [ToolsModule],
  controllers: [PlannerController],
  providers: [PlannerService],
})
export class PlannerModule { }
