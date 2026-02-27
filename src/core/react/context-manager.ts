/**
 * ContextManager - 上下文管理器
 *
 * 负责管理 ReAct 循环中的上下文长度和内容压缩。
 * 主要功能：
 * 1. Token 估算（CJK/ASCII 分段估算）
 * 2. 消息截断（原子组截断，保留工具调用对完整性）
 * 3. 工具结果压缩（代码感知的策略注册机制）
 */

import { SystemMessage, HumanMessage, AIMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { ReActLogger } from '../ReActLogger.js';
import {
  DEFAULT_MAX_CONTEXT_TOKENS,
  DEFAULT_MAX_TOOL_RESULT_LENGTH,
  CJK_TOKEN_RATIO,
  ASCII_TOKEN_RATIO,
  MESSAGE_OVERHEAD_TOKENS,
} from './constants.js';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 上下文管理器配置
 */
export interface ContextManagerConfig {
  /** 最大上下文 Token 数 */
  maxContextTokens: number;
  /** 是否启用压缩 */
  enableCompression: boolean;
  /** 工具结果最大长度（默认值，各策略可覆盖） */
  maxToolResultLength: number;
  /** 日志记录器 */
  logger?: ReActLogger;
}

/**
 * 压缩策略接口
 */
export interface CompressionStrategy {
  /** 策略名称 */
  name: string;
  /** 判断是否匹配当前工具 */
  match: (toolName: string) => boolean;
  /** 执行压缩 */
  compress: (result: string, maxLength: number) => string;
  /** 该策略的最大长度（覆盖全局默认） */
  maxLength?: number;
}

/**
 * 消息原子组 —— AIMessage(tool_calls) + 后续 ToolMessage[] 为一个不可拆分的组
 */
interface MessageGroup {
  messages: BaseMessage[];
  tokens: number;
}

// ============================================================================
// 内置压缩策略
// ============================================================================

/**
 * 代码文件压缩策略 —— 基于缩进层级的结构化大纲压缩
 *
 * 核心思路：代码文件的缩进层级天然反映了结构层次。
 * 低缩进行（层级 0-1）通常是 import、类声明、方法签名、接口定义、顶层常量等；
 * 高缩进行（层级 2+）通常是函数实现体。
 *
 * 保留所有低缩进行，将连续的高缩进行折叠为 "// ... [N lines]" 标记。
 * 这种方式：
 * - 跨语言通用（TS/JS/Python/Go 等）
 * - 天然处理多行签名、装饰器、JSDoc
 * - 保留代码的结构层次信息
 */
const codeFileStrategy: CompressionStrategy = {
  name: 'code_file',
  match: (toolName) => {
    const lower = toolName.toLowerCase();
    return lower.includes('read_file') || lower.includes('view_file') || lower.includes('read_code');
  },
  maxLength: 5000,
  compress: (result, maxLength) => {
    if (result.length <= maxLength) return result;

    const lines = result.split('\n');

    // 检测缩进风格：tab 或 space，以及每级缩进的空格数
    const indentUnit = detectIndentUnit(lines);

    // 计算每行的缩进层级
    const levels = lines.map(line => getIndentLevel(line, indentUnit));

    // 压缩阈值：保留层级 <= maxKeepLevel 的行
    // 先尝试 level 1（保留类成员签名），超长则降到 level 0
    let maxKeepLevel = 1;
    let compressed = buildOutline(lines, levels, maxKeepLevel);

    if (compressed.length > maxLength) {
      maxKeepLevel = 0;
      compressed = buildOutline(lines, levels, maxKeepLevel);
    }

    // 如果仍然超长，回退到头尾保留
    if (compressed.length > maxLength) {
      return compressWithHeadTail(result, maxLength);
    }

    return compressed;
  },
};

/**
 * 检测代码文件的缩进单位（每级缩进的空格数）
 */
function detectIndentUnit(lines: string[]): number {
  const indentCounts = new Map<number, number>();

  for (const line of lines) {
    if (line.trim() === '') continue;

    // 如果用的是 tab，返回特殊值 -1
    if (line.startsWith('\t')) return -1;

    const match = line.match(/^( +)/);
    if (match) {
      const spaces = match[1].length;
      if (spaces > 0 && spaces <= 8) {
        indentCounts.set(spaces, (indentCounts.get(spaces) || 0) + 1);
      }
    }
  }

  if (indentCounts.size === 0) return 2; // 默认 2 空格

  // 找最小的常见缩进量（出现次数 >= 3 的最小值）
  const sorted = [...indentCounts.entries()]
    .filter(([, count]) => count >= 3)
    .sort((a, b) => a[0] - b[0]);

  return sorted.length > 0 ? sorted[0][0] : 2;
}

/**
 * 计算单行的缩进层级
 */
function getIndentLevel(line: string, indentUnit: number): number {
  if (line.trim() === '') return -1; // 空行标记为 -1

  if (indentUnit === -1) {
    // Tab 缩进
    let tabs = 0;
    for (const ch of line) {
      if (ch === '\t') tabs++;
      else break;
    }
    return tabs;
  }

  // Space 缩进
  let spaces = 0;
  for (const ch of line) {
    if (ch === ' ') spaces++;
    else break;
  }
  return Math.floor(spaces / indentUnit);
}

/**
 * 根据缩进层级阈值构建代码大纲
 * 保留 level <= maxKeepLevel 的行，折叠连续的深层级行
 */
function buildOutline(lines: string[], levels: number[], maxKeepLevel: number): string {
  const output: string[] = [];
  let foldedCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const level = levels[i];

    // 空行：如果前后都是保留行则保留，否则纳入折叠区
    if (level === -1) {
      // 向后看一行，如果下一行是保留行则保留空行
      const nextLevel = i + 1 < lines.length ? levels[i + 1] : 0;
      if (nextLevel !== -1 && nextLevel <= maxKeepLevel) {
        // 先输出之前的折叠标记
        if (foldedCount > 0) {
          output.push(`    // ... [${foldedCount} lines folded]`);
          foldedCount = 0;
        }
        output.push(lines[i]);
      } else {
        foldedCount++;
      }
      continue;
    }

    if (level <= maxKeepLevel) {
      // 先输出之前的折叠标记
      if (foldedCount > 0) {
        output.push(`    // ... [${foldedCount} lines folded]`);
        foldedCount = 0;
      }
      output.push(lines[i]);
    } else {
      foldedCount++;
    }
  }

  // 末尾还有折叠的行
  if (foldedCount > 0) {
    output.push(`    // ... [${foldedCount} lines folded]`);
  }

  return output.join('\n');
}

/**
 * 搜索结果压缩策略
 * 保留所有匹配行，截断上下文行数，合并同文件结果
 */
const searchResultStrategy: CompressionStrategy = {
  name: 'search_result',
  match: (toolName) => {
    const lower = toolName.toLowerCase();
    return lower.includes('grep') || lower.includes('search') || lower.includes('ripgrep');
  },
  maxLength: 4000,
  compress: (result, maxLength) => {
    if (result.length <= maxLength) return result;

    const lines = result.split('\n');

    // 尝试识别结构化搜索结果（文件名:行号:内容 格式）
    const matchLineRegex = /^(.+?):(\d+)[:：]/;
    const matchLines: string[] = [];
    const contextLines: string[] = [];

    for (const line of lines) {
      if (matchLineRegex.test(line)) {
        matchLines.push(line);
      } else {
        contextLines.push(line);
      }
    }

    // 如果识别到了匹配行，优先保留匹配行
    if (matchLines.length > 0) {
      let compressed = matchLines.join('\n');
      if (compressed.length > maxLength) {
        // 匹配行本身太多，按条数截断
        const kept = matchLines.slice(0, Math.floor(matchLines.length * (maxLength / compressed.length)));
        const omitted = matchLines.length - kept.length;
        return kept.join('\n') + `\n\n... [已省略 ${omitted} 条匹配结果]`;
      }
      if (matchLines.length < lines.length) {
        compressed += `\n\n[注意：已省略 ${contextLines.length} 行上下文，仅保留 ${matchLines.length} 条匹配行]`;
      }
      return compressed;
    }

    // 无法识别结构 → 回退到头尾保留
    return compressWithHeadTail(result, maxLength);
  },
};

/**
 * 目录列表压缩策略
 * 头部保留，紧凑格式
 */
const listStrategy: CompressionStrategy = {
  name: 'list_result',
  match: (toolName) => {
    const lower = toolName.toLowerCase();
    return lower.includes('list') || lower.includes('find') || lower.includes('ls');
  },
  maxLength: 2000, // 目录列表给更少空间
  compress: (result, maxLength) => {
    if (result.length <= maxLength) return result;
    return compressWithHead(result, maxLength);
  },
};

/**
 * 默认压缩策略（头尾保留）
 */
const defaultStrategy: CompressionStrategy = {
  name: 'default',
  match: () => true, // 兜底，总是匹配
  compress: (result, maxLength) => {
    if (result.length <= maxLength) return result;
    return compressWithHeadTail(result, maxLength);
  },
};

// ============================================================================
// 压缩辅助函数
// ============================================================================

/**
 * 头尾保留压缩
 */
function compressWithHeadTail(text: string, maxLength: number): string {
  const halfLength = Math.floor((maxLength - 80) / 2); // 预留空间给省略提示
  const lines = text.split('\n');

  if (lines.length <= 20) {
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
 * 头部保留压缩
 */
function compressWithHead(text: string, maxLength: number): string {
  const lines = text.split('\n');

  if (lines.length <= 30) {
    return text.slice(0, maxLength - 30) + `\n... [已省略 ${text.length - maxLength + 30} 字符]`;
  }

  const headLines = lines.slice(0, 30);
  const omittedLines = lines.length - 30;

  return [
    ...headLines,
    `... [已省略 ${omittedLines} 行]`,
  ].join('\n');
}

// ============================================================================
// ContextManager 类
// ============================================================================

/**
 * 上下文管理器
 */
export class ContextManager {
  private config: Required<Omit<ContextManagerConfig, 'logger'>> & { logger?: ReActLogger };
  private strategies: CompressionStrategy[];

  constructor(config?: Partial<ContextManagerConfig>) {
    this.config = {
      maxContextTokens: config?.maxContextTokens ?? DEFAULT_MAX_CONTEXT_TOKENS,
      enableCompression: config?.enableCompression ?? true,
      maxToolResultLength: config?.maxToolResultLength ?? DEFAULT_MAX_TOOL_RESULT_LENGTH,
      logger: config?.logger,
    };

    // 注册内置压缩策略（顺序决定优先级，先匹配先使用）
    this.strategies = [
      codeFileStrategy,
      searchResultStrategy,
      listStrategy,
      defaultStrategy,
    ];
  }

  /**
   * 注册自定义压缩策略（插入到默认策略之前）
   */
  registerStrategy(strategy: CompressionStrategy): void {
    // 插入到 defaultStrategy 之前
    const defaultIdx = this.strategies.findIndex(s => s.name === 'default');
    if (defaultIdx >= 0) {
      this.strategies.splice(defaultIdx, 0, strategy);
    } else {
      this.strategies.push(strategy);
    }
  }

  // ========================================================================
  // Token 估算（P1a）
  // ========================================================================

  /**
   * 估算文本的 Token 数量
   * CJK 字符约 1 字 = 2 token，ASCII 字符约 4 字符 = 1 token
   */
  estimateTokens(text: string): number {
    if (!text) return 0;
    let count = 0;
    for (const char of text) {
      count += char.charCodeAt(0) > 0x7F ? CJK_TOKEN_RATIO : ASCII_TOKEN_RATIO;
    }
    return Math.ceil(count);
  }

  /**
   * 估算消息数组的总 Token 数（包含每条消息的结构开销）
   */
  estimateMessagesTokens(messages: BaseMessage[]): number {
    return messages.reduce((total, msg) => {
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      return total + this.estimateTokens(content) + MESSAGE_OVERHEAD_TOKENS;
    }, 0);
  }

  // ========================================================================
  // 消息截断（P0）
  // ========================================================================

  /**
   * 截断消息以适应 Token 预算
   *
   * 策略：
   * 1. 始终保留 SystemMessage
   * 2. 将 AIMessage(tool_calls) + 后续 ToolMessage[] 捆绑为不可拆分的原子组
   * 3. 从后向前以"组"为单位选择，保证工具调用对的完整性
   * 4. 如果截断了消息，插入截断提示（使用 SystemMessage）
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

    // 分离 SystemMessage 与其他消息
    const systemMessages = messages.filter(m => m instanceof SystemMessage);
    const otherMessages = messages.filter(m => !(m instanceof SystemMessage));

    // 计算 SystemMessage 占用的 Token
    const systemTokens = this.estimateMessagesTokens(systemMessages);
    const remainingBudget = budget - systemTokens;

    if (remainingBudget <= 0) {
      this.config.logger?.warn('⚠️ SystemMessage 超出预算', { systemTokens, budget });
      return systemMessages;
    }

    // 将 otherMessages 分组为原子消息组
    const groups = this.groupMessages(otherMessages);

    // 从后向前以"组"为单位选择
    const selectedGroups: MessageGroup[] = [];
    let usedTokens = 0;

    for (let i = groups.length - 1; i >= 0; i--) {
      const group = groups[i];
      if (usedTokens + group.tokens <= remainingBudget) {
        selectedGroups.unshift(group);
        usedTokens += group.tokens;
      } else {
        // 无法容纳更多组，停止
        break;
      }
    }

    // 组装最终消息
    const result: BaseMessage[] = [...systemMessages];

    // 如果截断了消息组，添加截断提示（使用 SystemMessage）
    const totalGroupCount = groups.length;
    const selectedGroupCount = selectedGroups.length;
    const truncatedGroupCount = totalGroupCount - selectedGroupCount;

    if (truncatedGroupCount > 0) {
      const truncatedMessageCount = groups
        .slice(0, truncatedGroupCount)
        .reduce((sum, g) => sum + g.messages.length, 0);

      result.push(
        new SystemMessage(
          `[上下文管理：因 Token 预算限制，已省略前 ${truncatedMessageCount} 条历史消息（${truncatedGroupCount} 个交互回合）。如需引用早期信息，请提示用户重新提供。]`
        )
      );

      this.config.logger?.info('✂️ 消息截断完成', {
        truncatedGroups: truncatedGroupCount,
        truncatedMessages: truncatedMessageCount,
        remainingGroups: selectedGroupCount,
        usedTokens,
        budget: remainingBudget,
      });
    }

    // 展开选中的组，还原为消息序列
    for (const group of selectedGroups) {
      result.push(...group.messages);
    }

    return result;
  }

  /**
   * 将消息序列分组为原子消息组
   *
   * 规则：
   * - AIMessage 带有 tool_calls → 它和后续连续的 ToolMessage 构成一个原子组
   * - 其他消息各自为一个独立组
   */
  private groupMessages(messages: BaseMessage[]): MessageGroup[] {
    const groups: MessageGroup[] = [];
    let i = 0;

    while (i < messages.length) {
      const msg = messages[i];

      // 检测 AIMessage 是否带有 tool_calls
      if (msg instanceof AIMessage && (msg as AIMessage).tool_calls?.length) {
        // 收集这条 AIMessage + 后续所有对应的 ToolMessage
        const groupMsgs: BaseMessage[] = [msg];
        let j = i + 1;

        while (j < messages.length && messages[j] instanceof ToolMessage) {
          groupMsgs.push(messages[j]);
          j++;
        }

        groups.push({
          messages: groupMsgs,
          tokens: this.estimateMessagesTokens(groupMsgs),
        });
        i = j;
      } else {
        // 普通消息，独立成组
        groups.push({
          messages: [msg],
          tokens: this.estimateMessagesTokens([msg]),
        });
        i++;
      }
    }

    return groups;
  }

  // ========================================================================
  // 工具结果压缩（P1b）
  // ========================================================================

  /**
   * 压缩工具执行结果
   * 通过策略注册表匹配工具类型，采用相应的压缩策略
   *
   * @param toolName 工具名称
   * @param result 原始结果
   * @returns 压缩后的结果
   */
  compressToolResult(toolName: string, result: string): string {
    if (!this.config.enableCompression) {
      return result;
    }

    // 从策略注册表中找到第一个匹配的策略
    const strategy = this.strategies.find(s => s.match(toolName));
    if (!strategy) {
      return result;
    }

    const maxLength = strategy.maxLength ?? this.config.maxToolResultLength;

    if (result.length <= maxLength) {
      return result;
    }

    this.config.logger?.debug('🗜️ 压缩工具结果', {
      toolName,
      strategy: strategy.name,
      originalLength: result.length,
      maxLength,
    });

    const compressed = strategy.compress(result, maxLength);

    // 注入压缩元信息，让 LLM 知道结果被压缩过
    if (compressed.length < result.length) {
      const lines = result.split('\n').length;
      const compressedLines = compressed.split('\n').length;
      return `${compressed}\n\n[⚠️ 注意：此结果已从 ${lines} 行压缩至 ${compressedLines} 行。如需完整内容，请重新调用工具获取特定区域。]`;
    }

    return compressed;
  }
}
