/**
 * Langfuse 监控集成模块
 *
 * 提供全链路追踪能力：
 * - Trace：代表一次完整的用户请求
 * - Span：代表请求中的一个步骤（BDD、Architect、CodeGen 等）
 * - Generation：代表一次 LLM 调用（由 CallbackHandler 自动采集）
 *
 * 设计原则：
 * - 优雅降级：环境变量未配置时静默跳过，不影响正常业务
 * - 单例模式：全局共享一个 Langfuse 客户端实例
 */

import { Langfuse } from 'langfuse';
import { CallbackHandler } from 'langfuse-langchain';
import { config as dotenvConfig } from 'dotenv';

dotenvConfig();

// ─── 全局单例 ───

let langfuseInstance: Langfuse | null = null;

/**
 * 判断 Langfuse 是否已配置（环境变量是否存在）
 */
export function isLangfuseEnabled(): boolean {
  return !!(
    process.env.LANGFUSE_PUBLIC_KEY &&
    process.env.LANGFUSE_SECRET_KEY
  );
}

/**
 * 获取全局 Langfuse 单例
 * 如果未配置则返回 null
 */
export function getLangfuse(): Langfuse | null {
  if (!isLangfuseEnabled()) return null;

  if (!langfuseInstance) {
    langfuseInstance = new Langfuse({
      publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
      secretKey: process.env.LANGFUSE_SECRET_KEY!,
      baseUrl: process.env.LANGFUSE_BASE_URL || 'http://localhost:3100',
    });
    console.log('[Langfuse] ✅ 客户端已初始化', {
      baseUrl: process.env.LANGFUSE_BASE_URL || 'http://localhost:3100',
    });
  }

  return langfuseInstance;
}

// ─── Trace / Span 创建 ───

export interface TraceOptions {
  name: string;
  userId?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
  input?: unknown;
}

/**
 * 创建一个新的 Trace（代表一次完整请求）
 * 如果 Langfuse 未启用，返回 null
 */
export function createTrace(options: TraceOptions) {
  const langfuse = getLangfuse();
  if (!langfuse) return null;

  const trace = langfuse.trace({
    name: options.name,
    userId: options.userId,
    sessionId: options.sessionId,
    metadata: options.metadata,
    input: options.input,
  });

  console.log(`[Langfuse] 📊 Trace 已创建: ${options.name}`);
  return trace;
}

/**
 * 为 LangChain 调用创建 CallbackHandler
 *
 * @param root - 已创建的 Trace 或 Span 对象
 * @returns CallbackHandler 实例，可传入 llm.invoke(messages, { callbacks: [handler] })
 *          如果 root 为空，返回 undefined
 */
export function createLangfuseCallbackHandler(
  root: LangfuseTrace | LangfuseSpan | null | undefined
): CallbackHandler | undefined {
  if (!root) return undefined;

  const handler = new CallbackHandler({
    root,
  });

  return handler;
}

/**
 * 在 Trace 上创建一个 Span（代表一个业务步骤）
 *
 * @param parent - 已创建的 Trace 或 Span 对象
 * @param options - Span 配置
 * @returns Span 对象，可用于记录 input/output 和创建子 Span
 *          如果 parent 为空，返回 null
 */
export function createSpan(
  parent: any,
  options: {
    name: string;
    input?: unknown;
    metadata?: Record<string, unknown>;
  }
) {
  if (!parent) return null;

  return parent.span({
    name: options.name,
    input: options.input,
    metadata: options.metadata,
  });
}

/**
 * 结束一个 Span，记录输出
 */
export function endSpan(
  span: ReturnType<typeof createSpan>,
  options?: {
    output?: unknown;
    statusMessage?: string;
    level?: 'DEBUG' | 'DEFAULT' | 'WARNING' | 'ERROR';
  }
) {
  if (!span) return;

  span.end({
    output: options?.output,
    statusMessage: options?.statusMessage,
    level: options?.level,
  });
}

/**
 * 在进程退出前刷新所有待发送的数据
 */
export async function flushLangfuse(): Promise<void> {
  if (langfuseInstance) {
    await langfuseInstance.flushAsync();
  }
}

// ─── 便捷类型导出 ───

export type LangfuseTrace = ReturnType<typeof createTrace>;
export type LangfuseSpan = ReturnType<typeof createSpan>;
