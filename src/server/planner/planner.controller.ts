/**
 * Planner 执行控制器
 */

import { Controller, Post, Body, Res, Inject } from '@nestjs/common';
import { Response } from 'express';
import { PlannerService } from './planner.service';
import { PlannerRequestDto } from './dto/planner-request.dto';

@Controller('api/planner')
export class PlannerController {
  constructor(@Inject(PlannerService) private readonly plannerService: PlannerService) { }

  @Post()
  async execute(@Body() dto: PlannerRequestDto, @Res() res: Response) {
    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    const sendSSE = (event: string, data: unknown) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const { goal, tools: toolNames = ['get_weather', 'calculator', 'web_search'] } = dto;

      if (!goal) {
        sendSSE('error', { message: '缺少 goal 参数' });
        res.end();
        return;
      }

      const result = await this.plannerService.run(
        goal,
        toolNames,
        (event) => {
          sendSSE(event.type, event);
        },
        (plan) => {
          sendSSE('plan_update', { type: 'plan_update', plan });
        }
      );

      // 发送完成事件
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
}
