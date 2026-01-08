/**
 * Coding 请求处理器
 */

import http from 'http';
import { CodingAgent } from '../../sub-agent/coding-agent/index.js';
import type { CodingAgentEvent } from '../../sub-agent/types/index.js';
import { persistProject } from '../../sub-agent/coding-agent/services/template-generator.js';
import { sendSSE, setSSEHeaders, parseBody } from '../utils/sse.js';

/**
 * 处理 Coding 请求
 */
export async function handleCodingRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  setSSEHeaders(res);

  try {
    const body = await parseBody(req);
    const { requirement, useRag = false, projectId } = body;
    console.log(
      `[CodingRequest] Starting: "${requirement.slice(0, 50)}...", useRag: ${useRag}, projectId: ${projectId || 'new'}`
    );

    if (!requirement) {
      sendSSE(res, 'error', { message: '缺少 requirement 参数' });
      res.end();
      return;
    }

    // 创建 CodingAgent
    const agent = new CodingAgent({
      model: 'claude-sonnet-4-20250514',
      provider: 'claude',
      useRag,
    });

    // 执行并流式返回结果
    const result = await agent.run({
      requirement,
      projectId,
      onProgress: (event: CodingAgentEvent) => {
        console.log(
          `[CodingRequest] Progress: ${event.type} ${event.type === 'phase_start' ? (event as any).phase : ''}`
        );
        // 直接发送事件，前端会根据类型处理
        sendSSE(res, event.type, event);
      },
    });

    // 自动持久化项目
    if (result.success && result.projectId) {
      try {
        await persistProject(result.projectId);
        console.log(`[CodingRequest] Automatically persisted project: ${result.projectId}`);
      } catch (persistError) {
        console.error(`[CodingRequest] Failed to automatically persist project:`, persistError);
      }
    }

    // 发送完成事件
    console.log(`[CodingRequest] Done: ${result.success}`);
    sendSSE(res, 'coding_done', {
      type: 'coding_done',
      success: result.success,
      bddFeatures: result.bddFeatures,
      architecture: result.architecture,
      generatedFiles: result.generatedFiles,
      tree: result.tree,
      summary: result.summary,
      projectId: result.projectId,
      error: result.error,
    });
    res.end();
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    sendSSE(res, 'error', { message });
    res.end();
  }
}
