/**
 * ReAct 执行服务
 */

import { Injectable, Inject } from '@nestjs/common';
import { ReActExecutor } from '../../core/react';
import {
  ReactConversationManager,
  reactConversationManager,
  EventSerializer,
  type ConversationEvent,
  type UserEvent,
  type ArtifactEvent,
} from '../../core/conversation';
import type { Tool, ReActEvent } from '../../types';
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

    // 加载会话历史并转换为 LLM 消息格式
    const history = await this.conversationManager.getHistory(conversationId);
    const unifiedHistory = EventSerializer.toLLMMessages(history);

    // 保存用户消息
    const userEvent: UserEvent = {
      id: `user_${Date.now()}`,
      type: 'user',
      content: input,
      timestamp: Date.now(),
    };
    await this.conversationManager.appendEvent(conversationId, userEvent);

    // 使用 EventSerializer 收集 AI 响应事件
    const serializer = new EventSerializer();
    const responseEvents: ConversationEvent[] = [];

    const wrappedOnMessage = (event: ReActEvent) => {
      // 1. SSE 推送原始事件（包括流式事件）给前端实时显示
      onMessage(event);

      // 2. 尝试生成持久化事件（流式事件在 isComplete 时才生成）
      const conversationEvent = serializer.processReActEvent(event);
      if (conversationEvent) {
        responseEvents.push(conversationEvent);
      }
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
      const artifactEvent: ArtifactEvent = {
        id: `artifact_${Date.now()}`,
        conversationId,
        type: 'artifact_event',
        artifacts,
        mode: 'react',
        timestamp: Date.now(),
      };

      // 发送给客户端
      onMessage(artifactEvent as unknown as ReActEvent);

      // 持久化到会话
      responseEvents.push(artifactEvent);
    }

    // 保存响应事件
    if (responseEvents.length > 0) {
      await this.conversationManager.appendEvents(conversationId, responseEvents);
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
}
