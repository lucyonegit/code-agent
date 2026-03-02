/**
 * AgentPauseController - 通用 Agent 暂停/恢复机制
 *
 * 完全去业务化：Core 不知道暂停的原因、内容或类型。
 * 只提供 pause(payload) → wait → resume(payload) 的能力。
 * 业务语义由上层（CodingAgent、PlannerExecutor 等）通过不透明 payload 处理。
 */

/**
 * 暂停选项
 */
export interface PauseOptions {
  /** 超时毫秒数，默认 5 分钟。超时后自动恢复（timedOut = true） */
  timeoutMs?: number;
}

/**
 * 暂停结果（pause() 的返回值）
 */
export interface PauseResult {
  /** 会话 ID */
  sessionId: string;
  /** 恢复时传入的不透明数据 */
  payload: Record<string, any>;
  /** 是否因超时自动恢复 */
  timedOut: boolean;
}

/**
 * 事件发射器类型 — 由业务层传入，core 通过它发出暂停/恢复事件
 */
export type PauseEventEmitter = (event: any) => void | Promise<void>;

/** 内部会话结构 */
interface PauseSession {
  resolve: (result: PauseResult) => void;
  timer: NodeJS.Timeout;
  sessionId: string;
  createdAt: number;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 分钟

class AgentPauseController {
  private sessions = new Map<string, PauseSession>();

  /**
   * 暂停 Agent 执行，等待外部恢复
   *
   * @param payload - 不透明数据，原样塞入 agent_pause SSE 事件
   * @param emitEvent - 业务层提供的事件发射器
   * @param options - 超时等配置
   * @returns 恢复后的结果（包含外部传回的 payload）
   *
   * @example
   * ```typescript
   * // 业务层（CodingAgent）调用
   * const result = await agentPauseController.pause(
   *   { type: 'clarification', questions: [...] },
   *   (event) => onProgress?.(event),
   *   { timeoutMs: 300000 }
   * );
   * const answers = result.payload.answers;
   * ```
   */
  async pause(
    payload: Record<string, any>,
    emitEvent: PauseEventEmitter,
    options?: PauseOptions
  ): Promise<PauseResult> {
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const sessionId = `pause_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // 1. 发出 agent_pause 事件（通知前端）
    await emitEvent({
      type: 'agent_pause',
      sessionId,
      payload,
      timestamp: Date.now(),
    });

    console.log(`[AgentPause] Session ${sessionId} created, waiting for resume...`);

    // 2. 创建 Promise 并等待
    return new Promise<PauseResult>((resolve) => {
      const timer = setTimeout(() => {
        this.sessions.delete(sessionId);
        console.log(`[AgentPause] Session ${sessionId} timed out after ${timeoutMs}ms`);
        resolve({
          sessionId,
          payload: {},
          timedOut: true,
        });
      }, timeoutMs);

      this.sessions.set(sessionId, {
        resolve,
        timer,
        sessionId,
        createdAt: Date.now(),
      });
    });
  }

  /**
   * 恢复已暂停的 Agent
   *
   * @param sessionId - pause() 生成的会话 ID
   * @param payload - 不透明数据，原样返回给 pause() 的调用方
   * @returns 是否成功恢复（false = session 不存在或已过期）
   */
  resume(sessionId: string, payload: Record<string, any>): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      console.warn(`[AgentPause] Session ${sessionId} not found or expired`);
      return false;
    }

    clearTimeout(session.timer);
    this.sessions.delete(sessionId);

    session.resolve({
      sessionId,
      payload,
      timedOut: false,
    });

    console.log(`[AgentPause] Session ${sessionId} resumed`);
    return true;
  }

  /**
   * 检查会话是否存在
   */
  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * 活跃会话数量（调试用）
   */
  get activeSessionCount(): number {
    return this.sessions.size;
  }
}

/** 全局单例 */
export const agentPauseController = new AgentPauseController();
