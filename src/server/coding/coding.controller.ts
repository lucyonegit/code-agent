/**
 * Coding Agent 控制器
 */

import { Controller, Post, Body, Res, Inject } from '@nestjs/common';
import { Response } from 'express';
import { CodingService } from './coding.service';
import { CodingRequestDto } from './dto/coding-request.dto';

@Controller('api/coding')
export class CodingController {
  constructor(@Inject(CodingService) private readonly codingService: CodingService) { }

  @Post()
  async execute(@Body() dto: CodingRequestDto, @Res() res: Response) {
    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');  // 禁用反向代理缓冲
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // 立即发送响应头，禁用 Nagle 算法
    res.flushHeaders();
    if (res.socket) {
      res.socket.setNoDelay(true);
    }

    const sendSSE = (event: string, data: unknown) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      // 强制刷新 TCP 缓冲区
      if (typeof (res as any).flush === 'function') {
        (res as any).flush();
      }
    };


    try {
      const { requirement, useRag = false, projectId } = dto;
      console.log(
        `[CodingController] Starting: "${requirement.slice(0, 50)}...", useRag: ${useRag}, projectId: ${projectId || 'new'}`
      );

      if (!requirement) {
        sendSSE('error', { message: '缺少 requirement 参数' });
        res.end();
        return;
      }

      const result = await this.codingService.run(
        requirement,
        useRag,
        projectId,
        (event) => {
          console.log(
            `[CodingController] Progress: ${event.type} ${event.type === 'phase_start' ? (event as any).phase : ''}`
          );
          sendSSE(event.type, event);
        }
      );

      // 发送完成事件（由 Agent 内部决定发送 coding_done 还是 query_complete）
      console.log(`[CodingController] Done: ${result.success}`);
      res.end();
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      sendSSE('error', { message });
      res.end();
    }
  }
}
