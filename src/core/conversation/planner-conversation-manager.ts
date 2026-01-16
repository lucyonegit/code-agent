/**
 * 规划模式会话管理器
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import type {
  PlannerConversation,
  PlanFile,
  PlannerConversationListItem,
  Plan,
  ConversationEvent,
  UserEvent,
} from './types.js';

const CONVERSATION_DIR = 'plan_conversation';
const CONVERSATION_FILENAME = 'conversation.json';
const PLAN_FILENAME = 'plan.json';
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
 * 获取计划文件路径
 */
function getPlanFilePath(conversationId: string): string {
  return join(getConversationPath(conversationId), PLAN_FILENAME);
}

/**
 * 创建空会话记录
 */
function createEmptyConversation(conversationId: string): PlannerConversation {
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
 * 创建空计划文件
 */
function createEmptyPlanFile(conversationId: string): PlanFile {
  const now = new Date().toISOString();
  return {
    planId: `plan_${Date.now()}`,
    conversationId,
    version: CURRENT_VERSION,
    currentPlan: null,
    planHistory: [],
    metadata: {
      createdAt: now,
      updatedAt: now,
      totalSteps: 0,
      completedSteps: 0,
      status: 'pending',
    },
  };
}

/**
 * 规划模式会话管理器
 */
export class PlannerConversationManager {
  /**
   * 保存会话
   */
  async save(conversationId: string, conversation: PlannerConversation): Promise<void> {
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
    console.log(`[PlannerConversationManager] Saved conversation to ${filePath}`);
  }

  /**
   * 加载会话
   */
  async load(conversationId: string): Promise<PlannerConversation | null> {
    const filePath = getConversationFilePath(conversationId);

    if (!existsSync(filePath)) {
      return null;
    }

    try {
      const content = readFileSync(filePath, 'utf-8');
      const conversation = JSON.parse(content) as PlannerConversation;
      console.log(
        `[PlannerConversationManager] Loaded ${conversation.events?.length || 0} events`
      );
      return conversation;
    } catch (e) {
      console.error(`[PlannerConversationManager] Failed to load conversation:`, e);
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

    // 处理事件，对于特定类型（plan_update, artifact_event）进行 upsert
    for (const event of events) {
      if (event.type === 'plan_update' || event.type === 'artifact_event') {
        const existingIndex = conversation.events.findIndex(e => e.type === event.type);
        if (existingIndex !== -1) {
          // 更新现有事件，保留原 ID 以确保持久化语义一致
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
   * 保存计划
   */
  async savePlan(conversationId: string, plan: Plan): Promise<void> {
    const conversationPath = getConversationPath(conversationId);
    const filePath = getPlanFilePath(conversationId);

    // 确保目录存在
    if (!existsSync(conversationPath)) {
      mkdirSync(conversationPath, { recursive: true });
    }

    // 加载现有计划文件或创建新的
    let planFile: PlanFile;
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, 'utf-8');
      planFile = JSON.parse(content) as PlanFile;
      // 保存到历史
      if (planFile.currentPlan) {
        planFile.planHistory.push({
          timestamp: new Date().toISOString(),
          plan: planFile.currentPlan,
          changeReason: 'Plan updated',
        });
      }
    } else {
      planFile = createEmptyPlanFile(conversationId);
    }

    // 更新当前计划
    planFile.currentPlan = plan;
    planFile.metadata.updatedAt = new Date().toISOString();
    planFile.metadata.totalSteps = plan.steps.length;
    planFile.metadata.completedSteps = plan.steps.filter(s => s.status === 'done').length;
    planFile.metadata.status = plan.steps.every(s => s.status === 'done' || s.status === 'skipped')
      ? 'completed'
      : plan.steps.some(s => s.status === 'in_progress')
        ? 'in_progress'
        : 'pending';

    writeFileSync(filePath, JSON.stringify(planFile, null, 2), 'utf-8');
    console.log(`[PlannerConversationManager] Saved plan to ${filePath}`);

    // 更新会话的 currentPlanId
    const conversation = await this.load(conversationId);
    if (conversation) {
      conversation.currentPlanId = planFile.planId;
      await this.save(conversationId, conversation);
    }
  }

  /**
   * 加载计划
   */
  async loadPlan(conversationId: string): Promise<PlanFile | null> {
    const filePath = getPlanFilePath(conversationId);

    if (!existsSync(filePath)) {
      return null;
    }

    try {
      const content = readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as PlanFile;
    } catch (e) {
      console.error(`[PlannerConversationManager] Failed to load plan:`, e);
      return null;
    }
  }

  /**
   * 获取会话列表
   */
  async listConversations(): Promise<PlannerConversationListItem[]> {
    const root = getConversationRoot();

    if (!existsSync(root)) {
      return [];
    }

    const dirs = readdirSync(root, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    const conversations: PlannerConversationListItem[] = [];

    for (const dir of dirs) {
      const conversation = await this.load(dir);
      const planFile = await this.loadPlan(dir);

      if (conversation) {
        const item: PlannerConversationListItem = {
          conversationId: conversation.conversationId,
          lastUserInput: conversation.metadata.lastUserInput,
          updatedAt: conversation.metadata.updatedAt,
          createdAt: conversation.metadata.createdAt,
          totalTurns: conversation.metadata.totalTurns,
        };

        if (planFile?.currentPlan) {
          item.currentPlan = {
            goal: planFile.currentPlan.goal,
            status: planFile.metadata.status,
            completedSteps: planFile.metadata.completedSteps,
            totalSteps: planFile.metadata.totalSteps,
          };
        }

        conversations.push(item);
      }
    }

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

    const { rmSync } = await import('fs');
    rmSync(conversationPath, { recursive: true, force: true });
    console.log(`[PlannerConversationManager] Deleted conversation ${conversationId}`);
    return true;
  }

  /**
   * 获取 artifacts 目录路径
   */
  getArtifactsPath(conversationId: string): string {
    return join(getConversationPath(conversationId), ARTIFACTS_DIR);
  }

  /**
   * 获取会话的 artifact 文件列表
   */
  async listArtifacts(conversationId: string): Promise<Array<{
    name: string;
    path: string;
    type: 'md' | 'html' | 'txt' | 'json' | 'other';
    size: number;
  }>> {
    const artifactsPath = this.getArtifactsPath(conversationId);

    if (!existsSync(artifactsPath)) {
      return [];
    }

    const files = readdirSync(artifactsPath, { withFileTypes: true })
      .filter(f => f.isFile())
      .map(f => {
        const filePath = join(artifactsPath, f.name);
        const stat = statSync(filePath);
        const ext = f.name.split('.').pop()?.toLowerCase() || '';
        const type = (['md', 'html', 'txt', 'json'].includes(ext) ? ext : 'other') as 'md' | 'html' | 'txt' | 'json' | 'other';

        return {
          name: f.name,
          path: f.name,
          type,
          size: stat.size,
        };
      });

    return files;
  }

  /**
   * 读取单个 artifact 文件内容
   */
  async readArtifact(conversationId: string, fileName: string): Promise<string> {
    const artifactsPath = this.getArtifactsPath(conversationId);
    const filePath = join(artifactsPath, fileName);

    if (!existsSync(filePath)) {
      throw new Error(`Artifact not found: ${fileName}`);
    }

    return readFileSync(filePath, 'utf-8');
  }
}

// 导出单例
export const plannerConversationManager = new PlannerConversationManager();
