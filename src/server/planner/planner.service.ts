/**
 * Planner 执行服务
 */

import { Injectable, Inject } from '@nestjs/common';
import { PlannerExecutor } from '../../core/PlannerExecutor';
import type { Tool, ReActEvent, Plan } from '../../types';
import { ToolsService } from '../tools/tools.service';

@Injectable()
export class PlannerService {
  constructor(@Inject(ToolsService) private readonly toolsService: ToolsService) { }

  /**
   * 执行 Planner 流程
   */
  async run(
    goal: string,
    toolNames: string[],
    onMessage: (event: ReActEvent) => void,
    onPlanUpdate: (plan: Plan) => void
  ) {
    // 获取请求的工具
    const tools: Tool[] = this.toolsService.getToolsByNames(toolNames);

    if (tools.length === 0) {
      throw new Error('没有可用的工具');
    }

    // 创建 PlannerExecutor
    const planner = new PlannerExecutor({
      plannerModel: 'claude-sonnet-4-20250514',
      executorModel: 'claude-sonnet-4-20250514',
      provider: 'claude',
      maxIterationsPerStep: 10,
      maxRePlanAttempts: 3,
    });

    // 执行并返回结果
    const result = await planner.run({
      goal,
      tools,
      onMessage,
      onPlanUpdate,
    });

    return result;
  }
}
