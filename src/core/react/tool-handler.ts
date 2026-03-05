/**
 * ReAct Agent 工具执行处理器
 */

import { ToolMessage } from '@langchain/core/messages';
import { type Tool, type ReActInput } from '../../types/index.js';
import { type ReActLogger } from '../ReActLogger.js';
import { type ContextManager } from './context-manager.js';

type ToolExecutionResult =
  | { type: 'final_answer'; answer: string }
  | { type: 'continue'; messages: ToolMessage[] };

export class ToolHandler {
  constructor(
    private tools: Tool[],
    private logger: ReActLogger,
    private onMessage?: ReActInput['onMessage'],
    private contextManager?: ContextManager
  ) { }

  /**
   * 批量处理工具调用
   * 包含 Final Answer 检查和普通工具执行
   */
  async handleToolCalls(
    toolCalls: Array<{ id?: string; name: string; args: any }>,
    finalAnswerToolName?: string
  ): Promise<ToolExecutionResult> {
    // 1. 检查是否调用了最终答案工具
    if (finalAnswerToolName) {
      const finalAnswerCall = toolCalls.find(call => call.name === finalAnswerToolName);
      if (finalAnswerCall) {
        return this.handleFinalAnswer(finalAnswerCall);
      }
    }

    // 2. 并行执行普通工具（多个工具调用之间通常无依赖关系）
    const results = await Promise.allSettled(
      toolCalls.map(call => this.executeTool(call))
    );

    const messages: ToolMessage[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        messages.push(result.value.message);
      } else {
        // Promise 被 reject（理论上 executeTool 内部已 catch，这是兜底）
        const errorMsg = result.reason instanceof Error ? result.reason.message : '未知错误';
        this.logger.error('工具并行执行异常', { error: errorMsg });
        messages.push(new ToolMessage({
          tool_call_id: `error_${Date.now()}`,
          content: `工具执行异常: ${errorMsg}`,
        }));
      }
    }

    return { type: 'continue', messages };
  }

  /**
   * 处理最终答案工具调用
   */
  private async handleFinalAnswer(call: {
    id?: string;
    name: string;
    args: any;
  }): Promise<ToolExecutionResult> {
    // 参数现在直接是字符串（z.string() schema）或兼容旧格式的对象
    const answer = typeof call.args === 'string'
      ? call.args
      : (call.args as { answer?: string }).answer || JSON.stringify(call.args);

    return { type: 'final_answer', answer };
  }

  /**
   * 执行单个工具调用
   */
  async executeTool(toolCall: { id?: string; name: string; args: Record<string, any> }): Promise<{
    message: ToolMessage;
    result: any;
    success: boolean;
  }> {
    const toolCallId = toolCall.id || `call_${Date.now()}`;
    const toolStartTime = Date.now();

    // 发出 tool_call 事件
    await this.emitEvent({
      type: 'tool_call',
      toolCallId,
      toolName: toolCall.name,
      args: toolCall.args,
      timestamp: toolStartTime,
    });

    // 查找工具
    const tool = this.tools.find(t => t.name === toolCall.name);
    let observation: string;
    let success = true;
    let tool_result: any;

    if (!tool) {
      observation = `工具 "${toolCall.name}" 未找到。可用工具: ${this.tools.map(t => t.name).join(', ')} `;
      success = false;
      this.logger.error('工具未找到', {
        toolName: toolCall.name,
        available: this.tools.map(t => t.name),
      });
      await this.emitEvent({
        type: 'error',
        message: observation,
        timestamp: Date.now(),
      });
    } else {
      try {
        this.logger.info(`🔧 执行工具: ${toolCall.name}`, { toolCallId });
        this.logger.debug('📤 工具参数', { args: toolCall.args });
        tool_result = await tool.execute(toolCall.args);

        // 如果启用了上下文管理器，压缩工具结果
        let compressedResult = tool_result;
        if (this.contextManager && typeof tool_result === 'string') {
          compressedResult = this.contextManager.compressToolResult(toolCall.name, tool_result);
          if (compressedResult.length < tool_result.length) {
            this.logger.debug('🗜️ 工具结果已压缩', {
              toolName: toolCall.name,
              originalLength: tool_result.length,
              compressedLength: compressedResult.length,
            });
          }
        }

        observation = `[工具 ${toolCall.name} 调用成功]\n工具执行结果：${compressedResult}`;
        this.logger.debug('📥 工具结果', {
          toolName: toolCall.name,
          resultPreview:
            typeof tool_result === 'string'
              ? tool_result.slice(0, 200)
              : JSON.stringify(tool_result).slice(0, 200),
        });
      } catch (error) {
        observation = `工具 ${toolCall.name} 执行失败: ${error instanceof Error ? error.message : '未知错误'} `;
        success = false;
        this.logger.error('工具执行失败', {
          toolName: toolCall.name,
          error: error instanceof Error ? error.message : '未知错误',
        });
        await this.emitEvent({
          type: 'error',
          message: observation,
          timestamp: Date.now(),
        });
      }
    }

    const toolDuration = Date.now() - toolStartTime;
    this.logger.info(`✅ 工具完成: ${toolCall.name}`, {
      success,
      duration: `${toolDuration}ms`,
    });

    // 发出 tool_call_result 事件
    await this.emitEvent({
      type: 'tool_call_result',
      toolCallId,
      toolName: toolCall.name,
      result: tool_result,
      success,
      duration: toolDuration,
      timestamp: Date.now(),
    });

    return {
      message: new ToolMessage({
        tool_call_id: toolCallId,
        content: observation,
      }),
      result: tool_result,
      success,
    };
  }

  private async emitEvent(event: any): Promise<void> {
    if (this.onMessage) {
      await this.onMessage(event);
    }
  }
}
