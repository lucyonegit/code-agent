/**
 * 消息格式转换工具
 *
 * 提供 UnifiedMessage 和 LangChain BaseMessage 之间的转换
 */

import {
  HumanMessage,
  AIMessage,
  ToolMessage,
  SystemMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import type { UnifiedMessage } from '../../types/unified-message.js';

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

