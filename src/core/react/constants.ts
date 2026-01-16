/**
 * ReAct Agent 核心常量
 */

import { z } from 'zod';
import { type Tool } from '../../types/index.js';

/**
 * 默认配置常量
 */
/** 默认最大迭代次数 */
export const DEFAULT_MAX_ITERATIONS = 30;
/** 默认最大输出 token 数（防止输出截断） */
export const DEFAULT_MAX_TOKENS = 8192;
/** Architect 工具推荐的 max_tokens（架构设计输出较大） */
export const ARCHITECT_MAX_TOKENS = 4096;
/** CodeGen 工具推荐的 max_tokens（代码生成输出最大） */
export const CODEGEN_MAX_TOKENS = 16384;

/**
 * 默认 ReAct 系统提示词
 */
export const DEFAULT_REACT_PROMPT = `你是一个超级聪明的AI助手，使用 ReAct（推理 + 行动）方法来解决问题。

工作流程：
1. 深度思考：根据任务的复杂程度，输出不同长度的思考过程。简单任务保持精炼，复杂任务（如涉及多步工具调度、复杂逻辑推演时）应进行深度拆解、方案比选和潜在问题预判。这一步不能省略，必须经过一段思考过程。
2. 如果需要使用工具，直接调用
3. 根据工具返回的结果继续处理

重要提示：
- 思考过程要**逻辑严密**。简单问题直击要点，复杂问题要展示你的思考路径。
- 直接说明你要做什么，明确行动意图。
- 需要使用工具时直接调用 function

🔍 历史信息优先规则（多轮对话优化）：
- 回答问题前，**先检查历史对话**中是否已有相关信息
- 如果用户的问题之前已经回答过，直接引用历史中的结果，**不需要再次调用工具**
- 只有当历史中没有相关信息，或者信息可能已过时时，才调用工具获取最新数据

⚠️⚠️⚠️ 数据传递规则（极其重要，违反将导致失败）⚠️⚠️⚠️
当一个工具的输出需要作为另一个工具的输入时：
1. **绝对禁止**：总结、改写、重新组织或描述上一步的输出
2. **必须做到**：将上一步工具返回的 JSON **完整复制粘贴**到下一步的参数中
3. **具体示例**：
   - 如果 decompose_to_bdd 返回: [{"feature_id": "xxx", "scenarios": [...]}]
   - 那么 design_architecture 的 bdd_scenarios 参数必须是: [{"feature_id": "xxx", "scenarios": [...]}]
   - 一个字符都不能改动！`;

/**
 * 默认最终答案工具
 */
export const defaultFinalAnswerTool: Tool = {
  name: 'give_final_answer',
  description: '当你完成所有思考和推理后，调用此函数给出最终答案。只在你确定答案时调用。',
  parameters: z.object({
    answer: z.string().describe('最终答案的完整内容'),
  }),
  execute: async () => '',
};

/**
 * 最终答案工具的系统提示词后缀模板
 */
export const FINAL_ANSWER_PROMPT_SUFFIX = (toolName: string) => `

特别注意：
- 当你有了最终答案，必须调用 ${toolName} 工具来给出答案
  - 最终答案必须通过调用 ${toolName} 工具来给出，不要直接在回复中给出最终答案`;

/**
 * 默认用户消息模板
 */
export const defaultUserMessageTemplate = (
  input: string,
  toolDescriptions: string,
  context?: string
): string => {
  let message = `任务: ${input} \n\n可用工具: \n${toolDescriptions} `;
  if (context) {
    message += `\n\n之前步骤的上下文: \n${context} `;
  }
  return message;
};

// ============================================================================
// 上下文管理配置常量
// ============================================================================

/** 默认最大上下文 Token 数（基于 Claude 3.5 Sonnet 200k 窗口，保守估计） */
export const DEFAULT_MAX_CONTEXT_TOKENS = 100000;

/** 默认工具结果最大长度（字符数） */
export const DEFAULT_MAX_TOOL_RESULT_LENGTH = 3000;

/** 默认流式输出延时（毫秒） */
export const DEFAULT_STREAM_DELAY_MS = 30;

/** Token 估算比率（每个 Token 约等于 4 个字符，中文约 2 个字符） */
export const TOKEN_ESTIMATE_RATIO = 2.5;
