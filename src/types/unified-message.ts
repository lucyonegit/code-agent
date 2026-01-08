/**
 * 统一消息格式 - 用于前后端消息历史同步
 *
 * 解决的问题：
 * - 后端使用 LangChain 的 AIMessage/ToolMessage 维护历史
 * - 前端使用细粒度 events (thought, tool_call, tool_result) 展示
 * - 多轮对话时无法从前端 events 还原后端 messages
 *
 * 解决方案：
 * - 定义统一消息格式作为 Single Source of Truth
 * - 后端在每次迭代后发送 message_sync 事件
 * - 前端累积 UnifiedMessage 数组用于历史还原
 */

/**
 * 工具调用结构
 */
export interface UnifiedToolCall {
  /** 工具调用唯一标识符 */
  id: string;
  /** 工具名称 */
  name: string;
  /** 调用参数 */
  args: Record<string, any>;
}

/**
 * 统一消息格式 - 前后端共用
 */
export interface UnifiedMessage {
  /** 消息唯一标识符 */
  id: string;
  /** 消息角色 */
  role: 'user' | 'assistant' | 'tool' | 'system';
  /** 时间戳 */
  timestamp: number;

  // === All roles can have content ===
  /** 消息内容 (thought/user input/system prompt) */
  content?: string;

  // === Assistant-specific ===
  /** 工具调用列表 (仅 assistant 消息) */
  toolCalls?: UnifiedToolCall[];

  // === Tool-specific ===
  /** 对应的 tool call ID (仅 tool 消息) */
  toolCallId?: string;
  /** 工具名称 (仅 tool 消息) */
  toolName?: string;
  /** 工具执行结果 (仅 tool 消息) */
  toolResult?: any;
  /** 工具执行是否成功 (仅 tool 消息) */
  success?: boolean;
}

/**
 * 消息同步事件 - 用于前后端历史同步
 */
export interface MessageSyncEvent {
  type: 'message_sync';
  /** 同步的消息 */
  message: UnifiedMessage;
  /** 时间戳 */
  timestamp: number;
}
