/**
 * Coding Agent 服务
 */

import { Injectable } from '@nestjs/common';
import { CodingAgent } from '../../sub-agent/coding-agent';
import type { CodingAgentEvent } from '../../sub-agent/types';
import { persistProject } from '../../sub-agent/coding-agent/services/template-generator';

@Injectable()
export class CodingService {
  /**
   * 执行 Coding Agent 流程
   */
  async run(
    requirement: string,
    useRag: boolean,
    projectId: string | undefined,
    onProgress: (event: CodingAgentEvent) => void
  ) {
    // 创建 CodingAgent
    const agent = new CodingAgent({
      model: 'claude-sonnet-4-20250514',
      provider: 'claude',
      useRag,
    });

    // 执行
    const result = await agent.run({
      requirement,
      projectId,
      onProgress,
    });

    // 自动持久化项目
    if (result.success && result.projectId) {
      try {
        await persistProject(result.projectId);
        console.log(`[CodingService] Automatically persisted project: ${result.projectId}`);
      } catch (persistError) {
        console.error(`[CodingService] Failed to automatically persist project:`, persistError);
      }
    }

    return result;
  }
}
