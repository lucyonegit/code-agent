/**
 * 统一的会话事件类型定义
 *
 * 设计原则：
 * 1. 流式事件（*_stream）：仅用于 SSE 推送前端实时显示，不持久化
 * 2. 持久化事件：存储到 conversation.json，加载历史时使用
 *
 * 这是 Single Source of Truth，前后端共用同一套类型定义
 */

import type { Plan, ArtifactInfo } from '../../types/index.js';

// ============================================================================
// 基础事件接口
// ============================================================================

export interface BaseEvent {
  id: string;
  type: string;
  timestamp: number;
}

// ============================================================================
// 流式事件（仅用于 SSE 推送，不持久化）
// ============================================================================

/**
 * 思考流式事件
 * 前端根据 thoughtId 聚合同一轮思考的多个 chunk
 */
export interface ThoughtStreamEvent extends BaseEvent {
  type: 'thought_stream';
  thoughtId: string;
  chunk: string;
  isComplete: boolean;
}

/**
 * 最终回复流式事件
 * 前端根据 answerId 聚合同一次回答的多个 chunk
 */
export interface FinalResultStreamEvent extends BaseEvent {
  type: 'final_result_stream';
  answerId: string;
  chunk: string;
  isComplete: boolean;
}

/**
 * 流式事件联合类型（不持久化）
 */
export type StreamingEvent = ThoughtStreamEvent | FinalResultStreamEvent;

// ============================================================================
// 持久化事件（存储到 conversation.json）
// ============================================================================

/**
 * 用户消息事件
 */
export interface UserEvent extends BaseEvent {
  type: 'user';
  content: string;
}

/**
 * 思考事件（完整内容，由流式事件聚合而来）
 */
export interface ThoughtEvent extends BaseEvent {
  type: 'thought';
  content: string;
}

/**
 * 普通消息事件
 */
export interface NormalMessageEvent extends BaseEvent {
  type: 'normal_message';
  content: string;
}

/**
 * 工具调用事件
 */
export interface ToolCallEvent extends BaseEvent {
  type: 'tool_call';
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

/**
 * 工具结果事件
 */
export interface ToolResultEvent extends BaseEvent {
  type: 'tool_result';
  toolCallId: string;
  toolName: string;
  result: string;
  success: boolean;
  duration: number;
}

/**
 * 最终回复事件（完整内容，由流式事件聚合而来）
 */
export interface FinalResultEvent extends BaseEvent {
  type: 'final_result';
  content: string;
}

/**
 * 错误事件
 */
export interface ErrorEvent extends BaseEvent {
  type: 'error';
  message: string;
  details?: unknown;
}

/**
 * 计划更新事件
 */
export interface PlanUpdateEvent extends BaseEvent {
  type: 'plan_update';
  plan: Plan;
}

/**
 * Artifact 更新事件
 */
export interface ArtifactEvent extends BaseEvent {
  type: 'artifact_event';
  artifacts: ArtifactInfo[];
  mode: 'react' | 'plan';
}

/**
 * 持久化事件联合类型
 */
export type ConversationEvent =
  | UserEvent
  | ThoughtEvent
  | NormalMessageEvent
  | ToolCallEvent
  | ToolResultEvent
  | FinalResultEvent
  | ErrorEvent
  | PlanUpdateEvent
  | ArtifactEvent;

/**
 * 所有事件联合类型（SSE 推送时使用）
 */
export type AllEvent = StreamingEvent | ConversationEvent;

/**
 * 持久化事件类型字符串
 */
export type ConversationEventType = ConversationEvent['type'];

/**
 * 流式事件类型字符串
 */
export type StreamingEventType = StreamingEvent['type'];
