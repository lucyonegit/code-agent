/**
 * 事件序列化器
 *
 * 职责：
 * 1. 聚合流式事件（thought_stream, final_result_stream）为完成态事件
 * 2. 转换 ConversationEvent 为 LLM 消息格式
 */

import type { ReActEvent, UnifiedMessage } from '../../types/index.js';
import type {
  ConversationEvent,
  ThoughtEvent,
  ToolCallEvent,
  ToolResultEvent,
  FinalResultEvent,
  ErrorEvent,
  NormalMessageEvent,
} from './conversation-event.js';

export class EventSerializer {
  private thoughtBuffer: Map<string, string> = new Map();
  private finalAnswerBuffer: Map<string, string> = new Map();

  /**
   * 处理 ReAct 流式事件，返回可持久化的 ConversationEvent
   * - 流式事件（thought_stream, final_result_stream）在 isComplete 时返回聚合结果
   * - 其他事件直接转换
   *
   * @returns ConversationEvent 或 null（流式中间态不生成持久化事件）
   */
  processReActEvent(event: ReActEvent): ConversationEvent | null {
    switch (event.type) {
      case 'thought': {
        // 聚合流式 thought（后端当前使用 'thought' 类型）
        const existing = this.thoughtBuffer.get(event.thoughtId) || '';
        this.thoughtBuffer.set(event.thoughtId, existing + event.chunk);

        if (event.isComplete) {
          const content = this.thoughtBuffer.get(event.thoughtId) || '';
          this.thoughtBuffer.delete(event.thoughtId);
          return {
            id: event.thoughtId,
            type: 'thought',
            content,
            timestamp: event.timestamp,
          } as ThoughtEvent;
        }
        return null; // 流式中间态不生成持久化事件
      }

      case 'final_answer_stream': {
        // 聚合流式 final_result（后端当前使用 'final_answer_stream' 类型）
        const existing = this.finalAnswerBuffer.get(event.answerId) || '';
        this.finalAnswerBuffer.set(event.answerId, existing + event.chunk);

        if (event.isComplete) {
          const content = this.finalAnswerBuffer.get(event.answerId) || '';
          this.finalAnswerBuffer.delete(event.answerId);
          return {
            id: event.answerId,
            type: 'final_result',
            content,
            timestamp: event.timestamp,
          } as FinalResultEvent;
        }
        return null; // 流式中间态不生成持久化事件
      }

      case 'tool_call':
        return {
          id: `tool_${event.toolCallId}`,
          type: 'tool_call',
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
          timestamp: event.timestamp,
        } as ToolCallEvent;

      case 'tool_call_result':
        return {
          id: `tool_result_${event.toolCallId}`,
          type: 'tool_result',
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          result: event.result,
          success: event.success,
          duration: event.duration,
          timestamp: event.timestamp,
        } as ToolResultEvent;

      case 'final_result':
        // 非流式场景的 final_result
        return {
          id: `final_${event.timestamp}`,
          type: 'final_result',
          content: event.content,
          timestamp: event.timestamp,
        } as FinalResultEvent;

      case 'error':
        return {
          id: `error_${event.timestamp}`,
          type: 'error',
          message: event.message,
          details: event.details,
          timestamp: event.timestamp || Date.now(),
        } as ErrorEvent;

      case 'normal_message':
        return {
          id: event.messageId,
          type: 'normal_message',
          content: event.content,
          timestamp: event.timestamp,
        } as NormalMessageEvent;

      default:
        return null;
    }
  }

  /**
   * 将 ConversationEvent 转换为 LLM 消息格式
   */
  static toLLMMessage(event: ConversationEvent): UnifiedMessage {
    switch (event.type) {
      case 'user':
        return {
          id: event.id,
          role: 'user',
          content: event.content,
          timestamp: event.timestamp,
        };

      case 'thought':
      case 'final_result':
      case 'normal_message':
        return {
          id: event.id,
          role: 'assistant',
          content: event.content,
          timestamp: event.timestamp,
        };

      case 'tool_call':
        return {
          id: event.id,
          role: 'assistant',
          timestamp: event.timestamp,
          toolCalls: [
            {
              id: event.toolCallId,
              name: event.toolName,
              args: event.args,
            },
          ],
        };

      case 'tool_result':
        return {
          id: event.id,
          role: 'tool',
          timestamp: event.timestamp,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          toolResult: event.result,
          success: event.success,
        };

      default:
        // plan_update, artifact_event, error 不需要送给 LLM
        return {
          id: event.id,
          role: 'system',
          timestamp: event.timestamp,
        };
    }
  }

  /**
   * 批量转换为 LLM 消息（过滤掉不需要送给 LLM 的事件类型）
   */
  static toLLMMessages(events: ConversationEvent[]): UnifiedMessage[] {
    return events
      .filter((e) => !['plan_update', 'artifact_event', 'error'].includes(e.type))
      .map((e) => EventSerializer.toLLMMessage(e));
  }
}
