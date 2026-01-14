/**
 * 推理模式会话管理器
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import type {
  ReactConversation,
  StoredMessage,
  ConversationListItem,
} from './types.js';

const CONVERSATION_DIR = 'react_conversation';
const CONVERSATION_FILENAME = 'conversation.json';
const ARTIFACTS_DIR = 'artifacts';
const CURRENT_VERSION = 2;

/**
 * 获取会话根目录
 */
function getConversationRoot(): string {
  return join(process.cwd(), CONVERSATION_DIR);
}

/**
 * 获取特定会话的目录路径
 */
function getConversationPath(conversationId: string): string {
  return join(getConversationRoot(), conversationId);
}

/**
 * 获取会话文件路径
 */
function getConversationFilePath(conversationId: string): string {
  return join(getConversationPath(conversationId), CONVERSATION_FILENAME);
}

/**
 * 创建空会话记录
 */
function createEmptyConversation(conversationId: string): ReactConversation {
  const now = new Date().toISOString();
  return {
    conversationId,
    version: CURRENT_VERSION,
    messages: [],
    metadata: {
      createdAt: now,
      updatedAt: now,
      totalTurns: 0,
      lastUserInput: '',
    },
  };
}

/**
 * 推理模式会话管理器
 */
export class ReactConversationManager {
  /**
   * 保存会话
   */
  async save(conversationId: string, conversation: ReactConversation): Promise<void> {
    const conversationPath = getConversationPath(conversationId);
    const filePath = getConversationFilePath(conversationId);

    // 创建会话目录和 artifacts 目录
    if (!existsSync(conversationPath)) {
      mkdirSync(conversationPath, { recursive: true });
    }
    const artifactsPath = join(conversationPath, ARTIFACTS_DIR);
    if (!existsSync(artifactsPath)) {
      mkdirSync(artifactsPath, { recursive: true });
    }

    writeFileSync(filePath, JSON.stringify(conversation, null, 2), 'utf-8');
    console.log(`[ReactConversationManager] Saved conversation to ${filePath}`);
  }

  /**
   * 加载会话
   */
  async load(conversationId: string): Promise<ReactConversation | null> {
    const filePath = getConversationFilePath(conversationId);

    if (!existsSync(filePath)) {
      return null;
    }

    try {
      const content = readFileSync(filePath, 'utf-8');
      const conversation = JSON.parse(content) as ReactConversation;
      console.log(
        `[ReactConversationManager] Loaded ${conversation.messages.length} messages`
      );
      return conversation;
    } catch (e) {
      console.error(`[ReactConversationManager] Failed to load conversation:`, e);
      return null;
    }
  }

  /**
   * 追加消息
   */
  async append(conversationId: string, message: StoredMessage): Promise<void> {
    await this.appendMessages(conversationId, [message]);
  }

  /**
   * 批量追加消息
   */
  async appendMessages(conversationId: string, messages: StoredMessage[]): Promise<void> {
    let conversation = await this.load(conversationId);

    if (!conversation) {
      conversation = createEmptyConversation(conversationId);
    }

    conversation.messages.push(...messages);
    conversation.metadata.updatedAt = new Date().toISOString();

    // 统计用户消息轮数
    const userMessages = messages.filter(m => m.type === 'user');
    if (userMessages.length > 0) {
      conversation.metadata.totalTurns += userMessages.length;
      conversation.metadata.lastUserInput =
        userMessages[userMessages.length - 1].content.slice(0, 100);
    }

    await this.save(conversationId, conversation);
  }

  /**
   * 获取历史消息
   */
  async getHistory(conversationId: string): Promise<StoredMessage[]> {
    const conversation = await this.load(conversationId);
    return conversation?.messages || [];
  }

  /**
   * 获取会话列表
   */
  async listConversations(): Promise<ConversationListItem[]> {
    const root = getConversationRoot();

    if (!existsSync(root)) {
      return [];
    }

    const dirs = readdirSync(root, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    const conversations: ConversationListItem[] = [];

    for (const dir of dirs) {
      const conversation = await this.load(dir);
      if (conversation) {
        conversations.push({
          conversationId: conversation.conversationId,
          lastUserInput: conversation.metadata.lastUserInput,
          updatedAt: conversation.metadata.updatedAt,
          createdAt: conversation.metadata.createdAt,
          totalTurns: conversation.metadata.totalTurns,
        });
      }
    }

    // 按更新时间降序排序
    return conversations.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  /**
   * 删除会话
   */
  async delete(conversationId: string): Promise<boolean> {
    const conversationPath = getConversationPath(conversationId);

    if (!existsSync(conversationPath)) {
      return false;
    }

    // 递归删除目录
    const { rmSync } = await import('fs');
    rmSync(conversationPath, { recursive: true, force: true });
    console.log(`[ReactConversationManager] Deleted conversation ${conversationId}`);
    return true;
  }
}

// 导出单例
export const reactConversationManager = new ReactConversationManager();
