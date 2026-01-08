/**
 * 工具列表控制器
 */

import { Controller, Get, Inject } from '@nestjs/common';
import { ToolsService } from './tools.service';

@Controller('api/tools')
export class ToolsController {
  constructor(@Inject(ToolsService) private readonly toolsService: ToolsService) { }

  @Get()
  getTools() {
    return {
      tools: this.toolsService.getToolsList(),
    };
  }
}

