/**
 * ReAct 执行模块
 */

import { Module } from '@nestjs/common';
import { ReactController } from './react.controller';
import { ReactService } from './react.service';
import { ToolsModule } from '../tools/tools.module';

@Module({
  imports: [ToolsModule],
  controllers: [ReactController],
  providers: [ReactService],
})
export class ReactModule { }
