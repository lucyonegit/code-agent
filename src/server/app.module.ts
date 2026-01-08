/**
 * 根模块 - 导入所有业务模块
 */

import { Module } from '@nestjs/common';
import { CommonModule } from './common/common.module';
import { HealthModule } from './health/health.module';
import { ToolsModule } from './tools/tools.module';
import { ReactModule } from './react/react.module';
import { PlannerModule } from './planner/planner.module';
import { CodingModule } from './coding/coding.module';
import { ProjectsModule } from './projects/projects.module';

@Module({
  imports: [
    CommonModule,
    HealthModule,
    ToolsModule,
    ReactModule,
    PlannerModule,
    CodingModule,
    ProjectsModule,
  ],
})
export class AppModule { }
