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

⚠️⚠️⚠️ 输出格式规则（极其重要，必须严格遵守）⚠️⚠️⚠️
你的每次回复分为两个截然不同的部分：
1. **思考过程**（你的回复正文 content）：这是你的内部推理、分析和决策过程。用户会看到这部分标记为"思考中"。
2. **最终答案**（通过 give_final_answer 工具给出）：这是给用户的正式回答。

🚨 关键约束：
- 思考过程和最终答案**绝对不能是相同的内容**
- 思考过程应该是：分析问题 → 制定策略 → 推理判断（偏过程性、分析性）
- 最终答案应该是：整理好的、面向用户的完整回答（偏结论性、呈现性）
- 即使是简单问题，也必须先在 content 中简要分析，然后再通过工具给出答案
- **禁止**将最终答案直接写在 content 中——content 只用于思考推理

工作流程：
1. 思考：在回复正文中输出你的推理过程。简单任务一两句话即可（如"这是一个自我介绍的问题，我来组织一下回答"），复杂任务应深度拆解。
2. 行动：如果需要使用工具获取信息，直接调用工具
3. 回答：当你准备好最终答案后，调用 give_final_answer 工具给出

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
- 你必须先在回复正文中输出思考/推理过程，然后再调用 ${toolName} 工具给出最终答案
- 回复正文（content）中只写思考分析过程，**不要把最终答案写在 content 里**
- 最终答案必须且只能通过调用 ${toolName} 工具来给出
- 思考内容和最终答案的内容**必须不同**：思考是推理过程，答案是结论呈现`;

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

/** CJK 字符 Token 估算比率（中文等宽字符约 1 字 = 2 token） */
export const CJK_TOKEN_RATIO = 2;

/** ASCII 字符 Token 估算比率（英文/代码约 4 字符 = 1 token） */
export const ASCII_TOKEN_RATIO = 0.25;

/** 每条消息的结构开销 Token 数（role, name, metadata 等） */
export const MESSAGE_OVERHEAD_TOKENS = 4;
