/**
 * ReAct 执行服务
 */

import { Injectable, Inject } from '@nestjs/common';
import { ReActExecutor } from '../../core/react';
import type { Tool, ReActEvent } from '../../types';
import { ToolsService } from '../tools/tools.service';

@Injectable()
export class ReactService {
  constructor(@Inject(ToolsService) private readonly toolsService: ToolsService) { }

  /**
   * 执行 ReAct 流程
   */
  async run(
    input: string,
    toolNames: string[],
    history: any[],
    onMessage: (event: ReActEvent) => void
  ) {
    // 获取请求的工具
    const tools: Tool[] = this.toolsService.getToolsByNames(toolNames);

    if (tools.length === 0) {
      throw new Error('没有可用的工具');
    }

    // 创建 ReActExecutor
    const executor = new ReActExecutor({
      model: 'claude-sonnet-4-20250514',
      provider: 'claude',
      streaming: true,
      maxIterations: 10,
    });

    // 执行并返回结果
    const result = await executor.run({
      input,
      tools,
      initialMessages: history,
      onMessage,
    });

    return result;
  }
}
