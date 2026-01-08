/**
 * ReAct 执行控制器
 */

import { Controller, Post, Body, Res, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { Response } from 'express';
import { ReactService } from './react.service';
import { ReactRequestDto } from './dto/react-request.dto';

@Controller('api/react')
export class ReactController {
  constructor(@Inject(ReactService) private readonly reactService: ReactService) { }

  @Post()
  async execute(@Body() dto: ReactRequestDto, @Res() res: Response) {
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
      const {
        input,
        tools: toolNames = ['get_weather', 'calculator', 'web_search'],
        history = [],
      } = dto;

      if (!input) {
        sendSSE('error', { message: '缺少 input 参数' });
        res.end();
        return;
      }

      const result = await this.reactService.run(
        input,
        toolNames,
        history,
        (event) => {
          sendSSE(event.type, event);
        }
      );

      // 发送完成事件
      sendSSE('done', { result });
      res.end();
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      sendSSE('error', { message });
      res.end();
    }
  }
}
