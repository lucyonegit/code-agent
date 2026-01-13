/**
 * 意图分类器 - 判断用户需求类型
 */

import { createLLM } from '../../../core/BaseLLM';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { LLMProvider } from '../../../types/index';

export type IntentType = 'simple_query' | 'code_generation' | 'code_modification';

export interface IntentClassificationResult {
  intent: IntentType;
  confidence: number;
  reasoning: string;
}

/**
 * 使用 LLM 判断用户意图
 */
export async function classifyIntent(
  requirement: string,
  config: {
    model: string;
    provider: LLMProvider;
    baseUrl?: string;
  }
): Promise<IntentClassificationResult> {
  const { tool } = await import('@langchain/core/tools');
  const { z } = await import('zod');

  // 定义意图分类工具
  const classifyTool = tool(
    async ({ intent, confidence, reasoning }) => ({ intent, confidence, reasoning }),
    {
      name: 'classify_intent',
      description: '分类用户意图',
      schema: z.object({
        intent: z.enum(['simple_query', 'code_generation', 'code_modification']).describe(
          '意图类型：simple_query=简单查询（如搜索代码、查看文件等），code_generation=生成新项目，code_modification=修改现有项目'
        ),
        confidence: z.number().min(0).max(1).describe('置信度 0-1'),
        reasoning: z.string().describe('判断理由（简短）'),
      }),
    }
  );

  const llm = createLLM(config);
  const llmWithTools = llm.bindTools([classifyTool]);

  const response = await llmWithTools.invoke([
    new SystemMessage(`你是一个意图分类器。分析用户需求，判断属于哪种类型：

1. **simple_query** (简单查询):
   - 查找代码位置："找一下XXX在哪个文件"
   - 查看文件内容："看一下XX文件的内容"
   - 列出项目结构："项目有哪些文件"
   - 代码理解："这段代码做了什么"
   - 不涉及代码修改或生成

2. **code_generation** (生成新项目):
   - 创建新应用："生成一个登录页"
   - 从零开始："做一个TODO应用"
   - 不是基于现有项目

3. **code_modification** (修改现有项目):
   - 修改现有代码："把按钮改成红色"
   - 添加功能："添加一个搜索功能"
   - 基于现有项目的改动

你必须使用 classify_intent 工具返回结果。`),
    new HumanMessage(`用户需求: ${requirement}`),
  ]);

  const toolCalls = response.tool_calls;
  if (toolCalls && toolCalls.length > 0) {
    const classifyCall = toolCalls.find(tc => tc.name === 'classify_intent');
    if (classifyCall && classifyCall.args) {
      return classifyCall.args as IntentClassificationResult;
    }
  }

  // 降级：返回默认值
  console.warn('[IntentClassifier] 未能从 LLM 获取分类，使用默认值');
  return {
    intent: 'code_generation',
    confidence: 0.5,
    reasoning: '无法分类，默认为代码生成',
  };
}
