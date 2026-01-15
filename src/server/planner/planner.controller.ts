/**
 * Planner 执行控制器
 */

import { Controller, Post, Get, Delete, Body, Param, Res, Inject } from '@nestjs/common';
import { Response } from 'express';
import { PlannerService } from './planner.service';
import { PlannerRequestDto } from './dto/planner-request.dto';

@Controller('api/planner')
export class PlannerController {
  constructor(@Inject(PlannerService) private readonly plannerService: PlannerService) { }

  /**
   * 执行 Planner 规划
   */
  @Post()
  async execute(@Body() dto: PlannerRequestDto, @Res() res: Response) {
    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    res.flushHeaders();
    if (res.socket) {
      res.socket.setNoDelay(true);
    }

    const sendSSE = (event: string, data: unknown) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      if (typeof (res as any).flush === 'function') {
        (res as any).flush();
      }
    };

    try {
      const {
        goal,
        conversationId = `plan_${Date.now()}`,
        tools: toolNames = ['get_weather', 'calculator', 'web_search']
      } = dto;

      if (!goal) {
        sendSSE('error', { message: '缺少 goal 参数' });
        res.end();
        return;
      }

      // 发送 conversationId 给客户端
      sendSSE('conversation_id', { conversationId });

      const result = await this.plannerService.run(
        conversationId,
        goal,
        toolNames,
        (event) => {
          sendSSE(event.type, event);
        },
        (plan) => {
          sendSSE('plan_update', { type: 'plan_update', plan });
        }
      );

      sendSSE('planner_done', {
        type: 'planner_done',
        success: result.success,
        response: result.response,
        plan: result.plan,
      });
      res.end();
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      sendSSE('error', { message });
      res.end();
    }
  }

  /**
   * 获取会话列表
   */
  @Get('conversations')
  async listConversations() {
    return this.plannerService.listConversations();
  }

  /**
   * 获取会话详情
   */
  @Get('conversation/:id')
  async getConversation(@Param('id') id: string) {
    const data = await this.plannerService.getConversation(id);
    if (!data.conversation) {
      return { error: 'Conversation not found' };
    }
    return data;
  }

  /**
   * 删除会话
   */
  @Delete('conversation/:id')
  async deleteConversation(@Param('id') id: string) {
    const success = await this.plannerService.deleteConversation(id);
    return { success };
  }

  /**
   * 获取会话的 artifact 文件列表
   */
  @Get('conversation/:id/artifacts')
  async listArtifacts(@Param('id') id: string) {
    const artifacts = await this.plannerService.listArtifacts(id);
    return { artifacts };
  }

  /**
   * 获取单个 artifact 文件内容
   */
  @Get('conversation/:id/artifacts/:fileName')
  async getArtifact(@Param('id') id: string, @Param('fileName') fileName: string) {
    try {
      const content = await this.plannerService.readArtifact(id, fileName);
      return { content };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
}
