/**
 * ReAct Agent 工具执行处理器
 */

import { ToolMessage } from '@langchain/core/messages';
import { type Tool, type ReActInput } from '../../types/index.js';
import { type ReActLogger } from '../ReActLogger.js';

export type ToolExecutionResult =
  | { type: 'final_answer'; answer: string }
  | { type: 'continue'; messages: ToolMessage[]; historyItems: string[] };

export class ToolHandler {
  constructor(
    private tools: Tool[],
    private logger: ReActLogger,
    private onMessage?: ReActInput['onMessage']
  ) {}

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

    // 2. 执行普通工具
    const messages: ToolMessage[] = [];
    const historyItems: string[] = [];

    for (const call of toolCalls) {
      const result = await this.executeTool(call);
      messages.push(result.message);
      historyItems.push(result.historyItem);
    }

    return { type: 'continue', messages, historyItems };
  }

  /**
   * 处理最终答案工具调用
   */
  private async handleFinalAnswer(call: {
    id?: string;
    name: string;
    args: any;
  }): Promise<ToolExecutionResult> {
    const answer = (call.args as { answer?: string }).answer || JSON.stringify(call.args);
    const toolCallId = call.id || `call_${Date.now()}`;

    // 发出 final_result 事件会在 executor 中统一处理，主要发出 sync 和 tool events
    // 发送 tool 消息同步事件
    const toolMsgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    await this.emitEvent({
      type: 'message_sync',
      message: {
        id: toolMsgId,
        role: 'tool',
        toolCallId,
        toolName: call.name,
        toolResult: answer,
        success: true,
        timestamp: Date.now(),
      },
      timestamp: Date.now(),
    });

    return { type: 'final_answer', answer };
  }

  /**
   * 执行单个工具调用
   */
  async executeTool(toolCall: { id?: string; name: string; args: Record<string, any> }): Promise<{
    message: ToolMessage;
    result: any;
    success: boolean;
    historyItem: string;
  }> {
    const toolCallId = toolCall.id || `call_${Date.now()} `;
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
        observation = `[工具 ${toolCall.name} 调用成功]\n工具执行结果：${tool_result}`;
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

    // 发送 tool 消息同步事件
    const toolMsgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    await this.emitEvent({
      type: 'message_sync',
      message: {
        id: toolMsgId,
        role: 'tool',
        toolCallId,
        toolName: toolCall.name,
        toolResult: tool_result,
        success,
        timestamp: Date.now(),
      },
      timestamp: Date.now(),
    });

    return {
      message: new ToolMessage({
        tool_call_id: toolCallId,
        content: observation,
      }),
      result: tool_result,
      success,
      historyItem: `动作: ${toolCall.name} \n观察: ${observation} `,
    };
  }

  private async emitEvent(event: any): Promise<void> {
    if (this.onMessage) {
      await this.onMessage(event);
    }
  }
}
