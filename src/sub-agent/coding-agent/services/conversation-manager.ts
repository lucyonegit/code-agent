/**
 * 对话存储管理服务
 * 提供通用接口用于项目对话的持久化存储
 * 存储格式严格与前端 ChatItem 保持一致
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getProjectPath, getTempProjectPath } from './project-manager';

// ============================================================================
// 类型定义 - 严格匹配前端 ChatItem
// ============================================================================

/**
 * 存储的消息类型 - 与前端 MessageType 一致
 */
export type StoredMessageType =
  | 'user'
  | 'thought'
  | 'normal_message'
  | 'tool_call'
  | 'tool_result'
  | 'final_result'
  | 'error';

/**
 * 存储的消息接口 - 与前端 ChatItem 保持一致
 */
export interface StoredMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';  // 用于转换为 LangChain Message
  type: StoredMessageType;
  content: string;
  timestamp: number;
  // 工具调用相关 (type === 'tool_call' 或 'tool_result' 时使用)
  toolCallId?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  result?: string;
  success?: boolean;
  duration?: number;
  // 流式状态
  isStreaming?: boolean;
  isComplete?: boolean;
}

/**
 * 对话记录接口
 */
export interface Conversation {
  projectId: string;
  version: number;
  messages: StoredMessage[];
  metadata: {
    createdAt: string;
    updatedAt: string;
    totalTurns: number;
    lastRequirement: string;
  };
}

/**
 * 对话存储接口
 */
export interface IConversationStorage {
  save(projectId: string, conversation: Conversation): Promise<void>;
  load(projectId: string): Promise<Conversation | null>;
  append(projectId: string, message: StoredMessage): Promise<void>;
  appendMessages(projectId: string, messages: StoredMessage[]): Promise<void>;
}

// ============================================================================
// 多轮上下文构建
// ============================================================================

/**
 * 格式化最近消息用于上下文
 */
function formatRecentMessages(messages: StoredMessage[]): string {
  return messages
    .map(msg => {
      if (msg.type === 'user') {
        return `[用户] ${msg.content}`;
      } else if (msg.type === 'thought') {
        return `[AI 思考] ${msg.content}`;
      } else if (msg.type === 'tool_call') {
        return `[工具调用] ${msg.toolName}: ${msg.result || '执行中...'}`;
      } else if (msg.type === 'final_result') {
        return `[AI 回复] ${msg.content}`;
      }
      return `[其他] ${msg.content}`;
    })
    .join('\n\n');
}

/**
 * 生成历史对话摘要
 */
function generateHistorySummary(messages: StoredMessage[]): string {
  const userMessages = messages.filter(m => m.type === 'user');
  if (userMessages.length === 0) return '';

  const requirements = userMessages.map(m => `- ${m.content.slice(0, 100)}`);
  return `之前进行了 ${userMessages.length} 轮对话，涉及:\n${requirements.join('\n')}`;
}

/**
 * 构建多轮对话上下文
 */
export function buildMultiTurnContext(
  storedConversation: Conversation,
  currentRequirement: string,
  projectFiles: string[]
): string {
  const { messages } = storedConversation;

  const historySummary =
    messages.length > 6
      ? generateHistorySummary(messages.slice(0, -6))
      : '';

  const recentMessages = messages.slice(-6);

  const projectSummary =
    projectFiles.length > 0
      ? `当前项目文件:\n${projectFiles.slice(0, 20).join('\n')}${projectFiles.length > 20 ? `\n... 共 ${projectFiles.length} 个文件` : ''}`
      : '';

  const parts: string[] = [];

  if (historySummary) {
    parts.push(`## 历史交互摘要\n${historySummary}`);
  }

  if (recentMessages.length > 0) {
    parts.push(`## 最近对话\n${formatRecentMessages(recentMessages)}`);
  }

  if (projectSummary) {
    parts.push(`## 当前项目状态\n${projectSummary}`);
  }

  parts.push(`## 当前需求\n${currentRequirement}`);

  return parts.join('\n\n');
}

// ============================================================================
// 文件存储实现
// ============================================================================

const CONVERSATION_FILENAME = 'conversation.json';
const CURRENT_VERSION = 2; // 版本升级

/**
 * 获取对话文件路径
 * 
 * 优先返回临时目录路径，确保增量修改模式下对话被保存到临时目录
 * 这样 persistProject 时会随临时目录一起移动到持久化目录
 */
function getConversationPath(projectId: string): string {
  // 优先检查临时目录是否存在（增量修改模式）
  const tempDir = getTempProjectPath(projectId);
  if (existsSync(tempDir)) {
    return join(tempDir, CONVERSATION_FILENAME);
  }

  // 否则使用持久化目录
  const persistedDir = getProjectPath(projectId);
  return join(persistedDir, CONVERSATION_FILENAME);
}

/**
 * 创建空对话记录
 */
function createEmptyConversation(projectId: string): Conversation {
  const now = new Date().toISOString();
  return {
    projectId,
    version: CURRENT_VERSION,
    messages: [],
    metadata: {
      createdAt: now,
      updatedAt: now,
      totalTurns: 0,
      lastRequirement: '',
    },
  };
}

/**
 * 文件存储实现
 */
export class FileConversationStorage implements IConversationStorage {
  async save(projectId: string, conversation: Conversation): Promise<void> {
    const filePath = getConversationPath(projectId);
    const dir = join(filePath, '..');

    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(filePath, JSON.stringify(conversation, null, 2), 'utf-8');
    console.log(`[ConversationManager] Saved conversation to ${filePath}`);
  }

  async load(projectId: string): Promise<Conversation | null> {
    const filePath = getConversationPath(projectId);

    if (!existsSync(filePath)) {
      return null;
    }

    try {
      const content = readFileSync(filePath, 'utf-8');
      const conversation = JSON.parse(content) as Conversation;
      console.log(
        `[ConversationManager] Loaded ${conversation.messages.length} messages from ${filePath}`
      );
      return conversation;
    } catch (e) {
      console.error(`[ConversationManager] Failed to load conversation:`, e);
      return null;
    }
  }

  async append(projectId: string, message: StoredMessage): Promise<void> {
    await this.appendMessages(projectId, [message]);
  }

  async appendMessages(
    projectId: string,
    messages: StoredMessage[]
  ): Promise<void> {
    let conversation = await this.load(projectId);

    if (!conversation) {
      conversation = createEmptyConversation(projectId);
    }

    conversation.messages.push(...messages);
    conversation.metadata.updatedAt = new Date().toISOString();

    const userMessages = messages.filter(m => m.type === 'user');
    if (userMessages.length > 0) {
      conversation.metadata.totalTurns += userMessages.length;
      conversation.metadata.lastRequirement =
        userMessages[userMessages.length - 1].content.slice(0, 100);
    }

    await this.save(projectId, conversation);
  }
}

// ============================================================================
// 导出
// ============================================================================

export const conversationStorage = new FileConversationStorage();

// ============================================================================
// 消息收集器 - 用于在工作流中收集消息
// ============================================================================

/**
 * 对话消息收集器
 * 跟踪工具调用状态并生成完整的 StoredMessage
 */
export class ConversationCollector {
  private messages: StoredMessage[] = [];
  private toolCallMap: Map<string, StoredMessage> = new Map();
  private currentThought: { id: string; content: string } | null = null;

  /**
   * 添加用户消息
   */
  addUserMessage(content: string): void {
    this.messages.push({
      id: `user_${Date.now()}`,
      role: 'user',
      type: 'user',
      content,
      timestamp: Date.now(),
    });
  }

  /**
   * 处理思考事件 (流式累积)
   */
  handleThought(thoughtId: string, chunk: string, isComplete: boolean): void {
    if (!this.currentThought || this.currentThought.id !== thoughtId) {
      // 保存之前的思考
      if (this.currentThought && this.currentThought.content) {
        this.messages.push({
          id: this.currentThought.id,
          role: 'assistant',
          type: 'thought',
          content: this.currentThought.content,
          timestamp: Date.now(),
          isComplete: true,
        });
      }
      // 开始新思考
      this.currentThought = { id: thoughtId, content: chunk };
    } else {
      // 累积内容
      this.currentThought.content += chunk;
    }

    // 如果思考完成，保存
    if (isComplete && this.currentThought) {
      this.messages.push({
        id: this.currentThought.id,
        role: 'assistant',
        type: 'thought',
        content: this.currentThought.content,
        timestamp: Date.now(),
        isComplete: true,
      });
      this.currentThought = null;
    }
  }

  /**
   * 处理工具调用事件
   */
  handleToolCall(
    toolCallId: string,
    toolName: string,
    args: Record<string, unknown>
  ): void {
    const msg: StoredMessage = {
      id: `tool_${toolCallId}`,
      role: 'assistant',
      type: 'tool_call',
      content: toolName,
      toolCallId,
      toolName,
      args,
      timestamp: Date.now(),
    };
    this.toolCallMap.set(toolCallId, msg);
    this.messages.push(msg);
  }

  /**
   * 处理工具调用结果事件
   * 总是添加一条 tool 角色的消息，用于 LangChain 转换
   */
  handleToolCallResult(
    toolCallId: string,
    toolName: string,
    result: string,
    success: boolean,
    duration: number
  ): void {
    // 添加 tool 角色的结果消息
    this.messages.push({
      id: `tool_result_${toolCallId}`,
      role: 'tool',
      type: 'tool_result',
      content: result,  // content 存储实际结果
      toolCallId,
      toolName,
      result,
      success,
      duration,
      timestamp: Date.now(),
    });
  }

  /**
   * 添加最终结果
   */
  addFinalResult(content: string): void {
    // 确保保存任何未完成的思考
    if (this.currentThought && this.currentThought.content) {
      this.messages.push({
        id: this.currentThought.id,
        role: 'assistant',
        type: 'thought',
        content: this.currentThought.content,
        timestamp: Date.now(),
        isComplete: true,
      });
      this.currentThought = null;
    }

    this.messages.push({
      id: `final_${Date.now()}`,
      role: 'assistant',
      type: 'final_result',
      content,
      timestamp: Date.now(),
    });
  }

  /**
   * 添加错误消息
   */
  addError(message: string): void {
    this.messages.push({
      id: `error_${Date.now()}`,
      role: 'assistant',
      type: 'error',
      content: message,
      timestamp: Date.now(),
    });
  }

  /**
   * 添加普通消息
   */
  addNormalMessage(messageId: string, content: string): void {
    this.messages.push({
      id: messageId,
      role: 'assistant',
      type: 'normal_message',
      content,
      timestamp: Date.now(),
    });
  }

  /**
   * 获取所有消息
   */
  getMessages(): StoredMessage[] {
    return this.messages;
  }

  /**
   * 清空收集器
   */
  clear(): void {
    this.messages = [];
    this.toolCallMap.clear();
    this.currentThought = null;
  }
}
