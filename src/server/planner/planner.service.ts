/**
 * Planner 执行服务
 */

import { Injectable, Inject } from '@nestjs/common';
import { PlannerExecutor } from '../../core/PlannerExecutor';
import {
  PlannerConversationManager,
  plannerConversationManager,
  type StoredMessage,
} from '../../core/conversation';
import type { Tool, ReActEvent, Plan, UnifiedMessage } from '../../types';
import { ToolsService } from '../tools/tools.service';

@Injectable()
export class PlannerService {
  private conversationManager: PlannerConversationManager;

  constructor(@Inject(ToolsService) private readonly toolsService: ToolsService) {
    this.conversationManager = plannerConversationManager;
  }

  /**
   * 执行 Planner 流程
   */
  async run(
    conversationId: string,
    goal: string,
    toolNames: string[],
    onMessage: (event: ReActEvent) => void,
    onPlanUpdate: (plan: Plan) => void
  ) {
    // 获取请求的工具
    const tools: Tool[] = await this.toolsService.getToolsByNames(toolNames, {
      mode: 'plan',
      conversationId,
    });

    if (tools.length === 0) {
      throw new Error('没有可用的工具');
    }

    // 加载会话历史
    const history = await this.conversationManager.getHistory(conversationId);
    const unifiedHistory = this.convertToUnifiedMessages(history);

    // 保存用户消息
    const userMessage: StoredMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      type: 'user',
      content: goal,
      timestamp: Date.now(),
    };
    await this.conversationManager.append(conversationId, userMessage);

    // 收集响应消息
    const responseMessages: StoredMessage[] = [];
    let currentThought: { id: string; content: string } | null = null;

    const wrappedOnMessage = (event: ReActEvent) => {
      switch (event.type) {
        case 'thought':
          if (!currentThought || currentThought.id !== event.thoughtId) {
            if (currentThought && currentThought.content) {
              responseMessages.push({
                id: currentThought.id,
                role: 'assistant',
                type: 'thought',
                content: currentThought.content,
                timestamp: Date.now(),
                isComplete: true,
              });
            }
            currentThought = { id: event.thoughtId, content: event.chunk };
          } else {
            currentThought.content += event.chunk;
          }
          if (event.isComplete && currentThought) {
            responseMessages.push({
              id: currentThought.id,
              role: 'assistant',
              type: 'thought',
              content: currentThought.content,
              timestamp: Date.now(),
              isComplete: true,
            });
            currentThought = null;
          }
          break;
        case 'tool_call':
          responseMessages.push({
            id: `tool_${event.toolCallId}`,
            role: 'assistant',
            type: 'tool_call',
            content: event.toolName,
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            args: event.args,
            timestamp: event.timestamp,
          });
          break;
        case 'tool_call_result':
          responseMessages.push({
            id: `tool_result_${event.toolCallId}`,
            role: 'tool',
            type: 'tool_result',
            content: event.result,
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            result: event.result,
            success: event.success,
            duration: event.duration,
            timestamp: event.timestamp,
          });
          break;
        case 'final_result':
          responseMessages.push({
            id: `final_${Date.now()}`,
            role: 'assistant',
            type: 'final_result',
            content: event.content,
            timestamp: event.timestamp,
          });
          break;
      }
      onMessage(event);
    };

    const wrappedOnPlanUpdate = async (plan: Plan) => {
      // 保存计划
      await this.conversationManager.savePlan(conversationId, plan);
      onPlanUpdate(plan);
    };

    // 创建 PlannerExecutor
    const planner = new PlannerExecutor({
      plannerModel: 'claude-sonnet-4-20250514',
      executorModel: 'claude-sonnet-4-20250514',
      provider: 'claude',
      maxIterationsPerStep: 30,
      maxRePlanAttempts: 3,
    });

    // 执行并返回结果
    const result = await planner.run({
      goal,
      tools,
      onMessage: wrappedOnMessage,
      onPlanUpdate: wrappedOnPlanUpdate,
      initialMessages: unifiedHistory,
    });

    // 保存响应消息
    if (responseMessages.length > 0) {
      await this.conversationManager.appendMessages(conversationId, responseMessages);
    }

    return result;
  }

  /**
   * 获取会话列表
   */
  async listConversations() {
    return this.conversationManager.listConversations();
  }

  /**
   * 获取会话详情
   */
  async getConversation(conversationId: string) {
    const conversation = await this.conversationManager.load(conversationId);
    const plan = await this.conversationManager.loadPlan(conversationId);
    return { conversation, plan };
  }

  /**
   * 删除会话
   */
  async deleteConversation(conversationId: string) {
    return this.conversationManager.delete(conversationId);
  }

  /**
   * 将 StoredMessage 转换为 UnifiedMessage
   */
  private convertToUnifiedMessages(messages: StoredMessage[]): UnifiedMessage[] {
    return messages.map(msg => ({
      id: msg.id,
      role: msg.role,
      timestamp: msg.timestamp,
      content: msg.content,
      toolCallId: msg.toolCallId,
      toolName: msg.toolName,
      toolResult: msg.result,
      success: msg.success,
      toolCalls: msg.type === 'tool_call' && msg.toolCallId ? [{
        id: msg.toolCallId,
        name: msg.toolName!,
        args: msg.args || {},
      }] : undefined,
    }));
  }
}
