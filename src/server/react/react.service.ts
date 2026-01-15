/**
 * ReAct 执行服务
 */

import { Injectable, Inject } from '@nestjs/common';
import { ReActExecutor } from '../../core/react';
import {
  ReactConversationManager,
  reactConversationManager,
  type StoredMessage,
} from '../../core/conversation';
import type { Tool, ReActEvent, UnifiedMessage } from '../../types';
import { ToolsService } from '../tools/tools.service';

@Injectable()
export class ReactService {
  private conversationManager: ReactConversationManager;

  constructor(@Inject(ToolsService) private readonly toolsService: ToolsService) {
    this.conversationManager = reactConversationManager;
  }

  /**
   * 执行 ReAct 流程
   */
  async run(
    conversationId: string,
    input: string,
    toolNames: string[],
    onMessage: (event: ReActEvent) => void
  ) {
    // 获取请求的工具
    const tools: Tool[] = await this.toolsService.getToolsByNames(toolNames, {
      mode: 'react',
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
      content: input,
      timestamp: Date.now(),
    };
    await this.conversationManager.append(conversationId, userMessage);

    // 收集 AI 响应消息
    const responseMessages: StoredMessage[] = [];
    let currentThought: { id: string; content: string } | null = null;

    const wrappedOnMessage = (event: ReActEvent) => {
      // 收集消息用于存储
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
        case 'error':
          responseMessages.push({
            id: `error_${Date.now()}`,
            role: 'assistant',
            type: 'error',
            content: event.message,
            timestamp: event.timestamp || Date.now(),
          });
          break;
      }

      // 转发给客户端
      onMessage(event);
    };

    // 创建 ReActExecutor
    const executor = new ReActExecutor({
      model: 'claude-sonnet-4-20250514',
      provider: 'claude',
      streaming: true,
      maxIterations: 30,
    });

    // 执行并返回结果
    const result = await executor.run({
      input,
      tools,
      initialMessages: unifiedHistory,
      onMessage: wrappedOnMessage,
    });

    // 检查 artifacts 目录并发送 artifact_event
    const artifacts = await this.conversationManager.listArtifacts(conversationId);
    if (artifacts.length > 0) {
      const artifactEvent = {
        type: 'artifact_event' as const,
        conversationId,
        mode: 'react' as const,
        artifacts,
        timestamp: Date.now(),
      };

      // 发送给客户端
      onMessage(artifactEvent as unknown as ReActEvent);

      // 持久化到会话
      responseMessages.push({
        id: `artifact_${Date.now()}`,
        role: 'assistant',
        type: 'artifact_event',
        content: JSON.stringify(artifacts),
        timestamp: Date.now(),
      });
    }

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
    return this.conversationManager.load(conversationId);
  }

  /**
   * 删除会话
   */
  async deleteConversation(conversationId: string) {
    return this.conversationManager.delete(conversationId);
  }

  /**
   * 获取会话的 artifact 文件列表
   */
  async listArtifacts(conversationId: string) {
    return this.conversationManager.listArtifacts(conversationId);
  }

  /**
   * 读取单个 artifact 文件内容
   */
  async readArtifact(conversationId: string, fileName: string) {
    return this.conversationManager.readArtifact(conversationId, fileName);
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
