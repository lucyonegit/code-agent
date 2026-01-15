/**
 * 会话存储相关类型定义
 */

/**
 * 存储的消息类型
 */
export type StoredMessageType =
  | 'user'
  | 'thought'
  | 'normal_message'
  | 'tool_call'
  | 'tool_result'
  | 'final_result'
  | 'error'
  | 'artifact_event'
  | 'plan_update';

/**
 * 存储的消息接口
 */
export interface StoredMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  type: StoredMessageType;
  content: string;
  timestamp: number;
  // 工具调用相关
  toolCallId?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  result?: string;
  success?: boolean;
  duration?: number;
  // 流式状态
  isStreaming?: boolean;
  isComplete?: boolean;
  // 计划相关
  plan?: Plan;
}

/**
 * 基础会话接口
 */
export interface BaseConversation {
  conversationId: string;
  version: number;
  messages: StoredMessage[];
  metadata: {
    createdAt: string;
    updatedAt: string;
    totalTurns: number;
    lastUserInput: string;
    model?: string;
    provider?: string;
  };
}

/**
 * 推理模式会话
 */
export interface ReactConversation extends BaseConversation {
  // 可扩展推理模式特有字段
}

/**
 * 规划模式会话
 */
export interface PlannerConversation extends BaseConversation {
  currentPlanId?: string;
}

/**
 * 计划文件接口
 */
export interface PlanFile {
  planId: string;
  conversationId: string;
  version: number;
  currentPlan: Plan | null;
  planHistory: PlanSnapshot[];
  metadata: {
    createdAt: string;
    updatedAt: string;
    totalSteps: number;
    completedSteps: number;
    status: 'pending' | 'in_progress' | 'completed' | 'failed';
  };
}

/**
 * 计划快照（用于历史记录）
 */
export interface PlanSnapshot {
  timestamp: string;
  plan: Plan;
  changeReason: string;
}

/**
 * 计划接口（从现有类型复用）
 */
export interface Plan {
  goal: string;
  steps: PlanStep[];
  reasoning: string;
  history: PlanHistoryEntry[];
}

export interface PlanStep {
  id: string;
  description: string;
  status: 'pending' | 'in_progress' | 'done' | 'failed' | 'skipped';
  requiredTools?: string[];
  dependencies?: string[];
  result?: string;
}

export interface PlanHistoryEntry {
  stepId: string;
  result: string;
  toolName?: string;
  resultType?: 'text' | 'json' | 'code' | 'markdown';
  timestamp: Date;
}

/**
 * 会话列表项（用于列表查询）
 */
export interface ConversationListItem {
  conversationId: string;
  lastUserInput: string;
  updatedAt: string;
  createdAt: string;
  totalTurns: number;
}

/**
 * 规划会话列表项（包含计划摘要）
 */
export interface PlannerConversationListItem extends ConversationListItem {
  currentPlan?: {
    goal: string;
    status: string;
    completedSteps: number;
    totalSteps: number;
  };
}
