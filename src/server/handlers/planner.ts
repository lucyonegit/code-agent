/**
 * Planner 请求处理器
 */

import http from 'http';
import { PlannerExecutor } from '../../core/PlannerExecutor.js';
import type { Tool, ReActEvent, Plan } from '../../types/index.js';
import { sendSSE, setSSEHeaders, parseBody } from '../utils/sse.js';
import { getToolsByNames } from '../tools/index.js';

/**
 * 处理 Planner 请求
 */
export async function handlePlannerRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  // 设置 SSE 头
  setSSEHeaders(res);

  try {
    // 解析请求体
    const body = await parseBody(req);
    const { goal, tools: toolNames = ['get_weather', 'calculator', 'web_search'] } = body;

    if (!goal) {
      sendSSE(res, 'error', { message: '缺少 goal 参数' });
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

    // 创建 PlannerExecutor
    const planner = new PlannerExecutor({
      plannerModel: 'claude-sonnet-4-20250514',
      executorModel: 'claude-sonnet-4-20250514',
      provider: 'claude',
      maxIterationsPerStep: 10,
      maxRePlanAttempts: 3,
    });

    // 执行并流式返回结果
    const result = await planner.run({
      goal,
      tools,
      onMessage: (event: ReActEvent) => {
        sendSSE(res, event.type, event);
      },
      onPlanUpdate: (plan: Plan) => {
        sendSSE(res, 'plan_update', { type: 'plan_update', plan });
      },
    });

    // 发送完成事件
    sendSSE(res, 'planner_done', {
      type: 'planner_done',
      success: result.success,
      response: result.response,
      plan: result.plan,
    });
    res.end();
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    sendSSE(res, 'error', { message });
    res.end();
  }
}
