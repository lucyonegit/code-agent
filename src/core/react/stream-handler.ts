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
import { type ReActInput, type ReActEvent } from '../../types/index.js';
import { type ReActLogger } from '../ReActLogger.js';
import { DEFAULT_STREAM_DELAY_MS } from './constants.js';

interface StreamResult {
  content: string;
  toolCalls: Array<{ id?: string; name: string; args: Record<string, any> }>;
  message: AIMessage;
}

/**
 * StreamHandler 配置
 */
interface StreamHandlerConfig {
  /** 最终答案工具名称 */
  finalAnswerToolName: string;
  /** 流式延时（毫秒）*/
  streamDelayMs: number;
}

export class StreamHandler {
  private config: StreamHandlerConfig;

  constructor(
    private logger: ReActLogger,
    private onMessage?: ReActInput['onMessage'],
    config?: Partial<StreamHandlerConfig>
  ) {
    this.config = {
      finalAnswerToolName: config?.finalAnswerToolName ?? 'give_final_answer',
      streamDelayMs: config?.streamDelayMs ?? DEFAULT_STREAM_DELAY_MS,
    };
  }

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
    // 用于跟踪 give_final_answer 流式输出的 ID
    let currentFinalAnswerId: string | null = null;
    // 用于跟踪已发送的 answer 内容长度
    let previousAnswerLength = 0;

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

          // 可配置延时：模拟流式效果（因 LiteLLM 代理批量返回 chunks）
          if (this.config.streamDelayMs > 0) {
            await this.delay(this.config.streamDelayMs);
          }
        }
      }



      // 阶段 2: Action 累积
      if (chunk.tool_call_chunks && chunk.tool_call_chunks.length > 0) {
        accumulatedToolCalls = mergeToolCalls(
          accumulatedToolCalls,
          chunk.tool_call_chunks as ToolCallChunk[]
        );

        // 检查是否正在调用 give_final_answer 工具，如果是则流式输出
        const finalAnswerCall = accumulatedToolCalls.find(tc => tc.name === this.config.finalAnswerToolName);
        if (finalAnswerCall) {
          // 生成或复用 answerId
          if (!currentFinalAnswerId) {
            currentFinalAnswerId = `final_${Date.now()}`;
            previousAnswerLength = 0;
            this.logger.debug('🔍 开始流式输出 final_answer', { answerId: currentFinalAnswerId });
          }

          // 提取当前完整的 answer 内容
          const currentAnswer = this.extractAnswerContent(finalAnswerCall.args);

          // 调试日志
          this.logger.trace('📦 final_answer 流式进度', {
            argsLength: finalAnswerCall.args.length,
            answerLength: currentAnswer.length,
            previousLength: previousAnswerLength,
          });

          // 只发送增量部分
          if (currentAnswer.length > previousAnswerLength) {
            const newChunk = currentAnswer.slice(previousAnswerLength);
            previousAnswerLength = currentAnswer.length;

            if (newChunk) {
              this.logger.trace('✅ 发送 final_answer chunk', { chunkLength: newChunk.length });
              await this.emitEvent({
                type: 'final_answer_stream',
                answerId: currentFinalAnswerId,
                chunk: newChunk,
                isComplete: false,
                timestamp: Date.now(),
              });
            }
          }
        }
      }
    }

    // 如果有流式的最终答案，发送完成事件
    if (currentFinalAnswerId) {
      await this.emitEvent({
        type: 'final_answer_stream',
        answerId: currentFinalAnswerId,
        chunk: '',
        isComplete: true,
        timestamp: Date.now(),
      });
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

  private async emitEvent(event: ReActEvent): Promise<void> {
    if (this.onMessage) {
      await this.onMessage(event);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 从 JSON 对象片段中提取 answer 字段的值
   * 参数格式: {"answer": "内容..."}
   * 流式时会逐步收到: {"answer": " → {"answer": "Hello → {"answer": "Hello World"}
   */
  private extractAnswerContent(argsJson: string): string {
    // 优先尝试 JSON.parse（完整 JSON 时更可靠）
    try {
      const parsed = JSON.parse(argsJson);
      if (parsed && typeof parsed.answer === 'string') {
        return parsed.answer;
      }
    } catch {
      // 流式传输中 JSON 不完整，回退到正则匹配
    }

    // 正则回退：匹配 "answer": "..." 模式（处理流式不完整 JSON）
    const match = argsJson.match(/"answer"\s*:\s*"/);
    if (!match) {
      return '';
    }

    // 提取 "answer": " 之后的内容
    const startIndex = match.index! + match[0].length;
    let content = argsJson.slice(startIndex);

    // 去除结尾的 "} 如果有的话（JSON 完成时会有）
    if (content.endsWith('"}')) {
      content = content.slice(0, -2);
    } else if (content.endsWith('"')) {
      content = content.slice(0, -1);
    }

    // 处理转义字符
    return content
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
}
