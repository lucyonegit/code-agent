/**
 * ReAct 请求处理器
 */

import http from 'http';
import { ReActExecutor } from '../../core/react/index.js';
import type { Tool, ReActEvent } from '../../types/index.js';
import { sendSSE, setSSEHeaders, parseBody } from '../utils/sse.js';
import { getToolsByNames } from '../tools/index.js';

/**
 * 处理 ReAct 请求
 */
export async function handleReactRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  // 设置 SSE 头
  setSSEHeaders(res);

  try {
    // 解析请求体
    const body = await parseBody(req);
    const {
      input,
      tools: toolNames = ['get_weather', 'calculator', 'web_search'],
      history = [],
    } = body;

    if (!input) {
      sendSSE(res, 'error', { message: '缺少 input 参数' });
      res.end();
      return;
    }

    // 获取请求的工具
    const tools: Tool[] = getToolsByNames(toolNames);

    if (tools.length === 0) {
      sendSSE(res, 'error', { message: '没有可用的工具' });
      res.end();
      return;
    }

    // 创建 ReActExecutor
    const executor = new ReActExecutor({
      model: 'claude-sonnet-4-20250514',
      provider: 'claude',
      streaming: true,
      maxIterations: 10,
    });

    // 执行并流式返回结果
    const result = await executor.run({
      input,
      tools,
      initialMessages: history, // 传递历史消息用于多轮对话
      onMessage: (event: ReActEvent) => {
        sendSSE(res, event.type, event);
      },
    });

    // 发送完成事件
    sendSSE(res, 'done', { result });
    res.end();
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    sendSSE(res, 'error', { message });
    res.end();
  }
}
