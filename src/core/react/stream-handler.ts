/**
 * ReAct Streaming 处理逻辑
 */

import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import {
  mergeToolCalls,
  toLangChainToolCalls,
  type AccumulatedToolCall,
  type ToolCallChunk,
} from '../utils/streamHelper.js';
import { type ReActInput } from '../../types/index.js';
import { type ReActLogger } from '../ReActLogger.js';

export interface StreamResult {
  content: string;
  toolCalls: Array<{ id?: string; name: string; args: Record<string, any> }>;
  message: AIMessage;
}

export class StreamHandler {
  constructor(
    private logger: ReActLogger,
    private onMessage?: ReActInput['onMessage']
  ) { }

  /**
   * 读取流并返回累积结果
   * 不再负责工具执行
   */
  async readStream(
    llm: ReturnType<ChatOpenAI['bindTools']>,
    messages: BaseMessage[],
    iterationId: string
  ): Promise<StreamResult> {
    const stream = await llm.stream(messages);

    // 累积内容和工具调用
    let accumulatedContent = '';
    let accumulatedToolCalls: AccumulatedToolCall[] = [];

    /** @type {AccumulatedToolCall[]} */

    // 处理流式数据Thought & ToolCall
    for await (const chunk of stream) {
      // 阶段 1: Thought 流式输出
      if (chunk.content) {
        const text = typeof chunk.content === 'string' ? chunk.content : '';
        if (text) {
          // TRACE 级别：流式 chunk 输出
          this.logger.streamChunk(text);
          accumulatedContent += text;
          await this.emitEvent({
            type: 'thought',
            thoughtId: iterationId,
            chunk: text,
            isComplete: false,
            timestamp: Date.now(),
          });

          // 人工延时：模拟流式效果（因 LiteLLM 代理批量返回 chunks）
          await this.delay(30);
        }
      }



      // 阶段 2: Action 累积
      if (chunk.tool_call_chunks && chunk.tool_call_chunks.length > 0) {
        accumulatedToolCalls = mergeToolCalls(
          accumulatedToolCalls,
          chunk.tool_call_chunks as ToolCallChunk[]
        );
      }
    }

    if (accumulatedContent) {
      this.logger.debug('🧠 流式思考完成', {
        contentLength: accumulatedContent.length,
        contentPreview: accumulatedContent.slice(0, 100),
      });
      await this.emitEvent({
        type: 'thought',
        thoughtId: iterationId,
        chunk: '',
        isComplete: true,
        timestamp: Date.now(),
      });
    }

    // 构建 AI 消息并添加到历史
    const toolCalls = toLangChainToolCalls(accumulatedToolCalls);

    // DEBUG：打印解析后的工具调用
    if (toolCalls.length > 0) {
      this.logger.debug('🔧 解析工具调用', {
        count: toolCalls.length,
        tools: toolCalls.map(tc => ({
          name: tc.name,
          argsLength: JSON.stringify(tc.args).length,
        })),
      });
    }

    const aiMessage = new AIMessage({
      content: accumulatedContent,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    });

    // 发送 assistant 消息同步事件
    const assistantMsgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    await this.emitEvent({
      type: 'message_sync',
      message: {
        id: assistantMsgId,
        role: 'assistant',
        content: accumulatedContent,
        toolCalls: toolCalls.map(tc => ({
          id: tc.id || `call_${Date.now()}`,
          name: tc.name,
          args: tc.args as Record<string, unknown>,
        })),
        timestamp: Date.now(),
      },
      timestamp: Date.now(),
    });

    return {
      content: accumulatedContent,
      toolCalls: toolCalls.map(tc => ({
        id: tc.id,
        name: tc.name,
        args: tc.args as Record<string, any>,
      })),
      message: aiMessage,
    };
  }

  private async emitEvent(event: any): Promise<void> {
    if (this.onMessage) {
      await this.onMessage(event);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

