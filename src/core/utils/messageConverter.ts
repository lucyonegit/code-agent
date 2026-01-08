/**
 * 消息格式转换工具
 *
 * 提供 UnifiedMessage 和 LangChain BaseMessage 之间的双向转换
 */

import {
  HumanMessage,
  AIMessage,
  ToolMessage,
  SystemMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import type { UnifiedMessage, UnifiedToolCall } from '../../types/unified-message.js';

/**
 * 将 UnifiedMessage 数组转换为 LangChain BaseMessage 数组
 *
 * @param history - 前端传入的统一消息历史
 * @returns LangChain 格式的消息数组
 */
export function convertToBaseMessages(history: UnifiedMessage[]): BaseMessage[] {
  return history.map(msg => {
    switch (msg.role) {
      case 'user':
        return new HumanMessage(msg.content || '');

      case 'assistant':
        return new AIMessage({
          content: msg.content || '',
          tool_calls: msg.toolCalls?.map(tc => ({
            id: tc.id,
            name: tc.name,
            args: tc.args,
            type: 'tool_call' as const,
          })),
        });

      case 'tool':
        return new ToolMessage({
          tool_call_id: msg.toolCallId || '',
          content:
            typeof msg.toolResult === 'string' ? msg.toolResult : JSON.stringify(msg.toolResult),
        });

      case 'system':
        return new SystemMessage(msg.content || '');

      default:
        // Fallback for unknown roles
        return new HumanMessage(msg.content || '');
    }
  });
}

/**
 * 将 LangChain BaseMessage 转换为 UnifiedMessage
 *
 * @param msg - LangChain 消息
 * @returns 统一消息格式
 */
export function convertFromBaseMessage(msg: BaseMessage): UnifiedMessage {
  const timestamp = Date.now();
  const id = `msg_${timestamp}_${Math.random().toString(36).slice(2, 9)}`;
  const content = typeof msg.content === 'string' ? msg.content : '';

  if (msg instanceof HumanMessage) {
    return {
      id,
      role: 'user',
      content,
      timestamp,
    };
  }

  if (msg instanceof AIMessage) {
    const aiMsg = msg as AIMessage;
    const toolCalls: UnifiedToolCall[] | undefined = aiMsg.tool_calls?.map(tc => ({
      id: tc.id || `call_${Date.now()}`,
      name: tc.name,
      args: tc.args as Record<string, any>,
    }));

    return {
      id,
      role: 'assistant',
      content,
      toolCalls: toolCalls?.length ? toolCalls : undefined,
      timestamp,
    };
  }

  if (msg instanceof ToolMessage) {
    const toolMsg = msg as ToolMessage;
    return {
      id,
      role: 'tool',
      toolCallId: toolMsg.tool_call_id,
      toolResult: content,
      timestamp,
    };
  }

  if (msg instanceof SystemMessage) {
    return {
      id,
      role: 'system',
      content,
      timestamp,
    };
  }

  // Fallback
  return {
    id,
    role: 'user',
    content,
    timestamp,
  };
}

/**
 * 批量转换 LangChain 消息为统一格式
 */
export function convertFromBaseMessages(messages: BaseMessage[]): UnifiedMessage[] {
  return messages.map(convertFromBaseMessage);
}
