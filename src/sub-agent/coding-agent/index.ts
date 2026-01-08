/**
 * CodingAgent - 编码智能体
 *
 * 固定工作流模式：
 * 用户需求 → BDD 拆解 → 架构设计 → 代码生成
 *
 * 通过程序化传递工具输出，避免 LLM 丢失或改写复杂 JSON 参数。
 */

import { createLLM } from '../../core/BaseLLM';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { runFixedWorkflow, runIncrementalWorkflow } from './workflows';
import type {
  CodingAgentConfig,
  CodingAgentInput,
  CodingAgentResult,
  CodingAgentEvent,
  BDDFeature,
  ArchitectureFile,
  CodeGenResult,
} from '../types/index';

/**
 * CodingAgent - 基于固定工作流的编码智能体
 */
export class CodingAgent {
  private config: CodingAgentConfig;

  constructor(config: CodingAgentConfig) {
    this.config = {
      model: config.model,
      provider: config.provider,
      baseUrl: config.baseUrl,
      streaming: config.streaming ?? false,
      useRag: config.useRag ?? true,
    };
  }

  /**
   * 运行编码流水线
   */
  async run(input: CodingAgentInput): Promise<CodingAgentResult> {
    const { requirement, projectId, files, onProgress } = input;

    // 创建 LLM 配置
    const llmConfig = {
      model: this.config.model,
      provider: this.config.provider,
      baseUrl: this.config.baseUrl,
    };

    // 存储中间结果
    const results = {
      bddFeatures: [] as BDDFeature[],
      architecture: [] as ArchitectureFile[],
      codeResult: undefined as CodeGenResult | undefined,
    };

    try {
      // 发送友好的开场提示
      const greeting = await this.generateGreeting(requirement);
      await this.emitEvent(onProgress, {
        type: 'normal_message',
        messageId: `greeting_${Date.now()}`,
        content: greeting,
        timestamp: Date.now(),
      });

      // 判断模式：有 projectId 则进入增量修改模式
      if (projectId) {
        await runIncrementalWorkflow(
          {
            requirement,
            projectId,
            llmConfig,
            useRag: this.config.useRag,
            onProgress,
          },
          results
        );
      } else if (files && files.length > 0) {
        // 向后兼容：如果有 files 但没有 projectId，提取 projectId
        const legacyProjectId = (files[0] as { projectId?: string }).projectId;
        if (legacyProjectId) {
          await runIncrementalWorkflow(
            {
              requirement,
              projectId: legacyProjectId,
              llmConfig,
              useRag: this.config.useRag,
              onProgress,
            },
            results
          );
        } else {
          await runFixedWorkflow(
            {
              requirement,
              llmConfig,
              useRag: this.config.useRag,
              onProgress,
            },
            results
          );
        }
      } else {
        // 正常全流程 - 使用固定工作流
        await runFixedWorkflow(
          {
            requirement,
            llmConfig,
            useRag: this.config.useRag,
            onProgress,
          },
          results
        );
      }

      // 发送 complete 事件通知业务层
      await this.emitEvent(onProgress, {
        type: 'complete',
        timestamp: Date.now(),
      });

      // 直接使用通过事件收集的结果
      return {
        success: true,
        bddFeatures: results.bddFeatures,
        architecture: results.architecture,
        generatedFiles: results.codeResult?.files || [],
        tree: results.codeResult?.tree,
        summary: results.codeResult?.summary || '',
        projectId: results.codeResult?.projectId,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      await this.emitEvent(onProgress, {
        type: 'error',
        message: errorMessage,
        timestamp: Date.now(),
      });
      return { success: false, error: errorMessage };
    }
  }

  /**
   * 发出事件
   */
  private async emitEvent(
    handler: CodingAgentInput['onProgress'],
    event: CodingAgentEvent
  ): Promise<void> {
    if (handler) await handler(event);
  }

  /**
   * 使用 LLM 生成友好的开场提示
   */
  private async generateGreeting(requirement: string): Promise<string> {
    const llm = createLLM({
      model: this.config.model,
      provider: this.config.provider,
      // apiKey: this.config.apiKey,
      // baseUrl: this.config.baseUrl,
    });

    console.log('createLLM', this.config);
    console.log(`[CodingAgent] Invoking LLM for greeting...`);
    const response = await llm.invoke([
      new SystemMessage(
        '你是一个友好的编程助手。根据用户的需求，生成一条简短的中文确认消息（20字以内），告诉用户你即将开始为他们做什么。语气要友好专业，可以使用1个emoji。只返回确认消息本身，不要有其他内容。示例："好的，我来帮您生成登录页 ✨"'
      ),
      new HumanMessage(`用户需求: ${requirement}`),
    ]);

    return (response.content as string).trim();
  }
}
