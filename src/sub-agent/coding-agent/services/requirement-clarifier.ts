/**
 * RequirementClarifier - 使用 LLM 判断需求是否需要澄清
 *
 * 分析用户需求的完整性，如果太模糊/简短，生成澄清问题
 */

import { createLLM } from '../../../core/BaseLLM';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { createLangfuseCallbackHandler, type LangfuseTrace } from '../../../core/langfuse';
import type { LLMProvider } from '../../../types/index';

/**
 * 澄清问题类型
 */
export interface ClarificationQuestion {
  id: string;
  question: string;
  type: 'text' | 'single_choice' | 'multi_choice';
  options?: string[];
  placeholder?: string;
}

/**
 * 需求分析结果
 */
export interface RequirementAnalysis {
  needsClarification: boolean;
  questions: ClarificationQuestion[];
  reasoning: string;
}

/**
 * 分析需求是否需要澄清
 */
export async function analyzeRequirement(
  requirement: string,
  config: {
    model: string;
    provider: LLMProvider;
    baseUrl?: string;
  },
  langfuseTrace?: LangfuseTrace
): Promise<RequirementAnalysis> {
  const { tool } = await import('@langchain/core/tools');
  const { z } = await import('zod');

  // 定义分析工具
  const analyzeTool = tool(
    async (input) => input,
    {
      name: 'analyze_requirement',
      description: '分析用户需求是否需要澄清',
      schema: z.object({
        needsClarification: z.boolean().describe(
          '是否需要澄清。如果需求足够清晰可以直接开发，返回 false'
        ),
        reasoning: z.string().describe('判断理由（简短）'),
        questions: z.array(z.object({
          id: z.string().describe('问题 ID，如 q1, q2'),
          question: z.string().describe('问题内容'),
          type: z.enum(['text', 'single_choice', 'multi_choice']).describe('问题类型'),
          options: z.array(z.string()).optional().describe('选项列表（choice 类型时必填）'),
          placeholder: z.string().optional().describe('输入提示（text 类型时可选）'),
        })).describe('需要用户回答的问题列表，最多3个'),
      }),
    }
  );

  const llm = createLLM(config);
  const llmWithTools = llm.bindTools([analyzeTool]);

  const callbackHandler = createLangfuseCallbackHandler(langfuseTrace ?? null);
  const callbacks = callbackHandler ? [callbackHandler as any] : undefined;
  const response = await llmWithTools.invoke([
    new SystemMessage(`你是一个需求分析专家。分析用户提供的软件开发需求，判断是否足够清晰可以直接开始开发。

## 判断标准

### 不需要澄清（needsClarification = false）的情况：
- 需求描述了明确的功能（如"用 React 做一个有增删改查的 TODO 应用，深色主题"）
- 虽然简短但意图明确（如"贪吃蛇小游戏"、"Markdown 编辑器"）
- 已经包含了足够的技术和功能细节

### 需要澄清（needsClarification = true）的情况：
- 需求极其模糊，无法判断要做什么（如"做个好看的页面"、"帮我写个应用"）
- 缺少关键信息导致无法做出合理假设（如"做个管理系统"——管理什么？）
- 一个词或短语，没有任何上下文（如"登录"、"CRM"）

## 生成问题的原则
1. 最多3个问题，聚焦最关键的缺失信息
2. 问题要具体、易回答
3. 优先使用 single_choice 类型，降低用户回答成本
4. 问题应该帮助确定：核心功能、应用类型、特殊需求

你必须使用 analyze_requirement 工具返回结果。`),
    new HumanMessage(`用户需求: ${requirement}`),
  ], { callbacks });

  const toolCalls = response.tool_calls;
  if (toolCalls && toolCalls.length > 0) {
    const analyzeCall = toolCalls.find(tc => tc.name === 'analyze_requirement');
    if (analyzeCall && analyzeCall.args) {
      const result = analyzeCall.args as RequirementAnalysis;
      console.log(`[RequirementClarifier] Analysis: needsClarification=${result.needsClarification}, questions=${result.questions.length}`);
      return result;
    }
  }

  // 降级：如果 LLM 没有调用工具，默认不需要澄清
  console.warn('[RequirementClarifier] LLM did not call tool, defaulting to no clarification needed');
  return {
    needsClarification: false,
    questions: [],
    reasoning: '无法分析，默认不需要澄清',
  };
}

/**
 * 将用户回答合并到原始需求中，生成增强的需求描述
 */
export async function enhanceRequirement(
  originalRequirement: string,
  answers: Record<string, string>,
  questions: ClarificationQuestion[],
  config: {
    model: string;
    provider: LLMProvider;
    baseUrl?: string;
  },
  langfuseTrace?: LangfuseTrace
): Promise<string> {
  // 如果没有回答，直接返回原始需求
  if (Object.keys(answers).length === 0) {
    return originalRequirement;
  }

  const { tool } = await import('@langchain/core/tools');
  const { z } = await import('zod');

  const answerTool = tool(
    async ({ enhanced_requirement }) => enhanced_requirement,
    {
      name: 'return_enhanced_requirement',
      description: '返回增强后的需求描述',
      schema: z.object({
        enhanced_requirement: z.string().describe('融合了用户补充信息的完整需求描述'),
      }),
    }
  );

  // 构建问答上下文
  const qaContext = questions
    .filter(q => answers[q.id])
    .map(q => `问：${q.question}\n答：${answers[q.id]}`)
    .join('\n\n');

  const llm = createLLM(config);
  const llmWithTools = llm.bindTools([answerTool]);

  const callbackHandler = createLangfuseCallbackHandler(langfuseTrace ?? null);
  const callbacks = callbackHandler ? [callbackHandler as any] : undefined;
  const response = await llmWithTools.invoke([
    new SystemMessage(
      '你是一个需求整合专家。将用户的原始需求和补充回答融合成一份完整、清晰的需求描述。' +
      '保持简洁，用自然语言描述，不要使用问答格式。你必须使用 return_enhanced_requirement 工具返回结果。'
    ),
    new HumanMessage(
      `原始需求: ${originalRequirement}\n\n用户补充信息:\n${qaContext}`
    ),
  ], { callbacks });

  const toolCalls = response.tool_calls;
  if (toolCalls && toolCalls.length > 0) {
    const call = toolCalls.find(tc => tc.name === 'return_enhanced_requirement');
    if (call?.args?.enhanced_requirement) {
      console.log(`[RequirementClarifier] Enhanced requirement: ${call.args.enhanced_requirement}`);
      return call.args.enhanced_requirement as string;
    }
  }

  // 降级：手动拼接
  const fallback = `${originalRequirement}\n\n补充信息：${qaContext}`;
  console.warn('[RequirementClarifier] LLM did not call tool, using manual concatenation');
  return fallback;
}
