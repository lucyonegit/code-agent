/**
 * ContextManager - 上下文管理器
 *
 * 负责管理 ReAct 循环中的上下文长度和内容压缩。
 * 主要功能：
 * 1. Token 估算
 * 2. 消息截断（保留重要消息）
 * 3. 工具结果压缩
 */

import { SystemMessage, HumanMessage, AIMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { ReActLogger } from '../ReActLogger.js';
import {
  DEFAULT_MAX_CONTEXT_TOKENS,
  DEFAULT_MAX_TOOL_RESULT_LENGTH,
  TOKEN_ESTIMATE_RATIO,
} from './constants.js';

/**
 * 上下文管理器配置
 */
export interface ContextManagerConfig {
  /** 最大上下文 Token 数 */
  maxContextTokens: number;
  /** 是否启用压缩 */
  enableCompression: boolean;
  /** 工具结果最大长度 */
  maxToolResultLength: number;
  /** 日志记录器 */
  logger?: ReActLogger;
}

/**
 * 上下文管理器
 */
export class ContextManager {
  private config: Required<Omit<ContextManagerConfig, 'logger'>> & { logger?: ReActLogger };

  constructor(config?: Partial<ContextManagerConfig>) {
    this.config = {
      maxContextTokens: config?.maxContextTokens ?? DEFAULT_MAX_CONTEXT_TOKENS,
      enableCompression: config?.enableCompression ?? true,
      maxToolResultLength: config?.maxToolResultLength ?? DEFAULT_MAX_TOOL_RESULT_LENGTH,
      logger: config?.logger,
    };
  }

  /**
   * 估算文本的 Token 数量
   * 使用简化公式：中英文混合场景下，约 2.5 个字符 = 1 个 Token
   */
  estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / TOKEN_ESTIMATE_RATIO);
  }

  /**
   * 估算消息数组的总 Token 数
   */
  estimateMessagesTokens(messages: BaseMessage[]): number {
    return messages.reduce((total, msg) => {
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      return total + this.estimateTokens(content);
    }, 0);
  }

  /**
   * 截断消息以适应 Token 预算
   * 策略：
   * 1. 始终保留 SystemMessage
   * 2. 始终保留最新的用户消息
   * 3. 从后向前保留消息，直到达到预算
   * 4. 如果截断了消息，插入截断提示
   *
   * @param messages 原始消息数组
   * @param reserveTokens 为 LLM 输出预留的 Token 数（默认 4000）
   * @returns 截断后的消息数组
   */
  truncateMessages(messages: BaseMessage[], reserveTokens: number = 4000): BaseMessage[] {
    const budget = this.config.maxContextTokens - reserveTokens;
    const totalTokens = this.estimateMessagesTokens(messages);

    // 如果在预算内，直接返回
    if (totalTokens <= budget) {
      return messages;
    }

    this.config.logger?.debug('🔄 上下文截断开始', {
      totalTokens,
      budget,
      messageCount: messages.length,
    });

    // 分离不同类型的消息
    const systemMessages = messages.filter(m => m instanceof SystemMessage);
    const otherMessages = messages.filter(m => !(m instanceof SystemMessage));

    // 计算 SystemMessage 占用的 Token
    const systemTokens = this.estimateMessagesTokens(systemMessages);
    const remainingBudget = budget - systemTokens;

    if (remainingBudget <= 0) {
      this.config.logger?.warn('⚠️ SystemMessage 超出预算', { systemTokens, budget });
      return systemMessages;
    }

    // 从后向前选择消息
    const selectedMessages: BaseMessage[] = [];
    let usedTokens = 0;

    for (let i = otherMessages.length - 1; i >= 0; i--) {
      const msg = otherMessages[i];
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      const msgTokens = this.estimateTokens(content);

      if (usedTokens + msgTokens <= remainingBudget) {
        selectedMessages.unshift(msg);
        usedTokens += msgTokens;
      } else {
        // 无法容纳更多消息，停止
        break;
      }
    }

    // 组装最终消息
    const result: BaseMessage[] = [...systemMessages];

    // 如果截断了消息，添加截断提示
    const truncatedCount = otherMessages.length - selectedMessages.length;
    if (truncatedCount > 0) {
      result.push(new HumanMessage(`[系统提示：因上下文长度限制，已省略前 ${truncatedCount} 条历史消息]`));
      this.config.logger?.info('✂️ 消息截断完成', {
        truncatedCount,
        remainingCount: selectedMessages.length,
        usedTokens,
        budget: remainingBudget,
      });
    }

    result.push(...selectedMessages);

    return result;
  }

  /**
   * 压缩工具执行结果
   * 根据工具类型采用不同的压缩策略
   *
   * @param toolName 工具名称
   * @param result 原始结果
   * @returns 压缩后的结果
   */
  compressToolResult(toolName: string, result: string): string {
    if (!this.config.enableCompression) {
      return result;
    }

    const maxLength = this.config.maxToolResultLength;

    if (result.length <= maxLength) {
      return result;
    }

    this.config.logger?.debug('🗜️ 压缩工具结果', {
      toolName,
      originalLength: result.length,
      maxLength,
    });

    // 根据工具类型选择压缩策略
    const lowerName = toolName.toLowerCase();

    if (lowerName.includes('read_file') || lowerName.includes('grep') || lowerName.includes('search')) {
      // 代码/搜索类：保留头尾
      return this.compressWithHeadTail(result, maxLength);
    }

    if (lowerName.includes('list') || lowerName.includes('find')) {
      // 列表类：保留头部
      return this.compressWithHead(result, maxLength);
    }

    // 默认：保留头尾
    return this.compressWithHeadTail(result, maxLength);
  }

  /**
   * 头尾保留压缩策略
   */
  private compressWithHeadTail(text: string, maxLength: number): string {
    const halfLength = Math.floor((maxLength - 50) / 2); // 预留空间给省略提示
    const lines = text.split('\n');

    if (lines.length <= 20) {
      // 行数少时，按字符截断
      const head = text.slice(0, halfLength);
      const tail = text.slice(-halfLength);
      return `${head}\n\n... [已省略 ${text.length - halfLength * 2} 字符] ...\n\n${tail}`;
    }

    // 按行截断
    const headLines = lines.slice(0, 15);
    const tailLines = lines.slice(-15);
    const omittedLines = lines.length - 30;

    return [
      ...headLines,
      '',
      `... [已省略 ${omittedLines} 行] ...`,
      '',
      ...tailLines,
    ].join('\n');
  }

  /**
   * 头部保留压缩策略
   */
  private compressWithHead(text: string, maxLength: number): string {
    const lines = text.split('\n');

    if (lines.length <= 30) {
      // 按字符截断
      return text.slice(0, maxLength - 30) + `\n... [已省略 ${text.length - maxLength + 30} 字符]`;
    }

    // 按行截断
    const headLines = lines.slice(0, 30);
    const omittedLines = lines.length - 30;

    return [
      ...headLines,
      `... [已省略 ${omittedLines} 行]`,
    ].join('\n');
  }
}
