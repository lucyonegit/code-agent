/**
 * 推理模式会话管理器
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { rmSync } from 'fs';
import type {
  ReactConversation,
  ConversationListItem,
  ConversationEvent,
  UserEvent,
} from './types.js';

const CONVERSATION_DIR = 'react_conversation';
const CONVERSATION_FILENAME = 'conversation.json';
const ARTIFACTS_DIR = 'artifacts';
const CURRENT_VERSION = 3;

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
    events: [],
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
        `[ReactConversationManager] Loaded ${conversation.events?.length || 0} events`
      );
      return conversation;
    } catch (e) {
      console.error(`[ReactConversationManager] Failed to load conversation:`, e);
      return null;
    }
  }

  /**
   * 追加事件
   */
  async appendEvent(conversationId: string, event: ConversationEvent): Promise<void> {
    await this.appendEvents(conversationId, [event]);
  }

  /**
   * 批量追加事件
   */
  async appendEvents(conversationId: string, events: ConversationEvent[]): Promise<void> {
    let conversation = await this.load(conversationId);

    if (!conversation) {
      conversation = createEmptyConversation(conversationId);
    }

    // 确保 events 字段存在
    if (!conversation.events) {
      conversation.events = [];
    }

    // 处理事件，对于 artifact_event 进行 upsert
    for (const event of events) {
      if (event.type === 'artifact_event') {
        const existingIndex = conversation.events.findIndex(e => e.type === event.type);
        if (existingIndex !== -1) {
          // 更新现有事件，保留原 ID
          conversation.events[existingIndex] = {
            ...event,
            id: conversation.events[existingIndex].id,
          };
          continue;
        }
      }
      conversation.events.push(event);
    }

    conversation.metadata.updatedAt = new Date().toISOString();

    // 统计用户消息轮数
    const userEvents = events.filter(e => e.type === 'user') as UserEvent[];
    if (userEvents.length > 0) {
      conversation.metadata.totalTurns += userEvents.length;
      conversation.metadata.lastUserInput =
        userEvents[userEvents.length - 1].content.slice(0, 100);
    }

    await this.save(conversationId, conversation);
  }

  /**
   * 获取历史事件
   */
  async getHistory(conversationId: string): Promise<ConversationEvent[]> {
    const conversation = await this.load(conversationId);
    return conversation?.events || [];
  }

  /**
   * 获取会话列表
   */
  async listConversations(): Promise<ConversationListItem[]> {
    const root = getConversationRoot();
    if (!existsSync(root)) {
      return [];
    }

    const conversations: ConversationListItem[] = [];
    const dirs = readdirSync(root);

    for (const dir of dirs) {
      const conversationPath = join(root, dir);
      const stat = statSync(conversationPath);

      if (stat.isDirectory()) {
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

    try {
      rmSync(conversationPath, { recursive: true, force: true });
      console.log(`[ReactConversationManager] Deleted conversation ${conversationId}`);
      return true;
    } catch (e) {
      console.error(`[ReactConversationManager] Failed to delete conversation:`, e);
      return false;
    }
  }

  /**
   * 获取 artifacts 目录路径
   */
  getArtifactsPath(conversationId: string): string {
    return join(getConversationPath(conversationId), ARTIFACTS_DIR);
  }

  /**
   * 列出会话的 artifacts
   */
  async listArtifacts(conversationId: string): Promise<{
    name: string;
    path: string;
    type: 'md' | 'html' | 'txt' | 'json' | 'other';
    size: number;
  }[]> {
    const artifactsPath = this.getArtifactsPath(conversationId);
    if (!existsSync(artifactsPath)) {
      return [];
    }

    const files = readdirSync(artifactsPath);
    return files.map(file => {
      const filePath = join(artifactsPath, file);
      const stat = statSync(filePath);
      const ext = file.split('.').pop()?.toLowerCase() || '';
      const type = (['md', 'html', 'txt', 'json'].includes(ext) ? ext : 'other') as 'md' | 'html' | 'txt' | 'json' | 'other';
      return {
        name: file,
        path: file,
        type,
        size: stat.size,
      };
    });
  }

  /**
   * 读取 artifact 内容
   */
  async readArtifact(conversationId: string, fileName: string): Promise<string | null> {
    const artifactsPath = this.getArtifactsPath(conversationId);
    const filePath = join(artifactsPath, fileName);

    if (!existsSync(filePath)) {
      console.error(`[ReactConversationManager] Artifact not found: ${fileName}`);
      return null;
    }

    return readFileSync(filePath, 'utf-8');
  }
}

// 导出单例
export const reactConversationManager = new ReactConversationManager();
