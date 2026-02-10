/**
 * PlannerExecutor - 双循环规划架构
 *
 * 实现 Planner + ReAct 两层循环：
 * - 外层循环：Planner 生成和调整计划
 * - 内层循环：ReActExecutor 执行每个步骤
 *
 * 这是一个业务无关的基础架构组件。
 * 所有提示词和消息都可通过 PlannerConfig 配置。
 */

import { createLLM } from '../BaseLLM.js';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { ReActExecutor } from '../react/index.js';
import {
  PlanSchema,
  type Plan,
  type PlanStep,
  type PlannerConfig,
  type PlannerInput,
  type PlannerResult,
  type Tool,
  type LLMProvider,
} from '../../types/index.js';

import { PlanRefinementSchema, type PlanRefinement } from './schema.js';
import {
  DEFAULT_PLANNER_PROMPT,
  DEFAULT_REFINE_PROMPT,
  DEFAULT_SUMMARY_PROMPT,
} from './prompts.js';
import {
  defaultPlanMessageTemplate,
  defaultRefineMessageTemplate,
  defaultSummaryMessageTemplate,
  isPlanComplete,
  getNextStep,
  getToolsForStep,
  formatPlanHistory,
} from './helpers.js';

/**
 * PlannerExecutor - 实现 Planner + ReAct 双循环架构
 */
export class PlannerExecutor {
  private config: {
    plannerModel: string;
    executorModel: string;
    provider: LLMProvider;
    maxIterationsPerStep: number;
    maxRePlanAttempts: number;
    apiKey?: string;
    baseUrl?: string;
    systemPrompt: string;
    refinePrompt: string;
    summaryPrompt: string;
    planMessageTemplate: (goal: string, toolDescriptions: string) => string;
    refineMessageTemplate: (plan: Plan, latestResult: string, tools: Tool[]) => string;
    summaryMessageTemplate: (plan: Plan) => string;
    executorConfig?: Partial<PlannerConfig['executorConfig']>;
  };

  constructor(config: PlannerConfig) {
    this.config = {
      plannerModel: config.plannerModel,
      executorModel: config.executorModel,
      provider: config.provider ?? 'openai',
      maxIterationsPerStep: config.maxIterationsPerStep ?? 10,
      maxRePlanAttempts: config.maxRePlanAttempts ?? 3,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      systemPrompt: config.systemPrompt ?? DEFAULT_PLANNER_PROMPT,
      refinePrompt: config.refinePrompt ?? DEFAULT_REFINE_PROMPT,
      summaryPrompt: config.summaryPrompt ?? DEFAULT_SUMMARY_PROMPT,
      planMessageTemplate: config.planMessageTemplate ?? defaultPlanMessageTemplate,
      refineMessageTemplate: config.refineMessageTemplate ?? defaultRefineMessageTemplate,
      summaryMessageTemplate: config.summaryMessageTemplate ?? defaultSummaryMessageTemplate,
      executorConfig: config.executorConfig,
    };
  }

  /**
   * 运行 Planner + ReAct
   */
  async run(input: PlannerInput): Promise<PlannerResult> {
    const { goal, tools, onMessage, onPlanUpdate, initialMessages } = input;

    try {
      // 步骤 1：生成初始计划
      const plan = await this.generatePlan(goal, tools);

      // 步骤 2：执行计划步骤
      let isFirstStep = true;

      while (!isPlanComplete(plan)) {
        const currentStep = getNextStep(plan);
        if (!currentStep) {
          break;
        }

        // 将步骤标记为进行中
        currentStep.status = 'in_progress';
        await onPlanUpdate?.(plan);

        // 获取此步骤的工具
        const stepTools = getToolsForStep(currentStep, tools);

        // 生成并发送友好提示
        const friendlyMessage = await this.generateFriendlyMessage(currentStep.description);
        await onMessage?.({
          type: 'normal_message',
          messageId: `step_hint_${currentStep.id}`,
          content: friendlyMessage,
          timestamp: Date.now(),
        });

        // 为此步骤创建 ReActExecutor
        const executor = new ReActExecutor({
          model: this.config.executorModel,
          provider: this.config.provider,
          maxIterations: this.config.maxIterationsPerStep,
          apiKey: this.config.apiKey,
          baseUrl: this.config.baseUrl,
          streaming: true,
          ...this.config.executorConfig,
        });

        console.log('ReAct Executor Running...');
        // 执行步骤，第一个步骤传递历史消息
        const stepResult = await executor.run({
          input: currentStep.description,
          context: formatPlanHistory(plan),
          tools: stepTools,
          onMessage,
          initialMessages: isFirstStep ? initialMessages : undefined,
        });
        isFirstStep = false;

        // 更新步骤状态
        currentStep.result = stepResult;
        currentStep.status = 'done';

        // 确定此步骤使用的主要工具及其返回类型
        const mainTool = stepTools.length > 0 ? stepTools[0] : undefined;

        plan.history.push({
          stepId: currentStep.id,
          result: stepResult,
          toolName: mainTool?.name,
          resultType: mainTool?.returnType || 'text',
          timestamp: new Date(),
        });
        await onPlanUpdate?.(plan);
      }

      // 生成最终响应
      const response = await this.generateFinalResponse(plan);

      return { success: true, response, plan };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      await onMessage?.({
        type: 'error',
        message: `规划器失败: ${errorMessage}`,
        timestamp: Date.now(),
      });

      return {
        success: false,
        response: `无法完成计划: ${errorMessage}`,
        plan: { goal, steps: [], reasoning: '计划执行失败', history: [] },
      };
    }
  }

  /**
   * 为给定目标生成初始计划
   * 使用 tool call 方式实现结构化输出
   */
  private async generatePlan(goal: string, tools: Tool[]): Promise<Plan> {
    const llm = createLLM({
      model: this.config.plannerModel,
      provider: this.config.provider,
      apiKey: this.config.apiKey,
      baseUrl: this.config.baseUrl,
    });

    // 定义 generate_plan 工具，用于获取结构化的计划输出
    const generatePlanTool = {
      name: 'generate_plan',
      description: '生成一个分步执行计划。你必须调用此工具来返回你的计划。',
      schema: PlanSchema,
    };

    // 绑定工具并强制使用
    const llmWithTool = llm.bindTools([generatePlanTool], {
      tool_choice: { type: 'function', function: { name: 'generate_plan' } },
    });

    const toolDescriptions = tools.map(t => `- ${t.name}: ${t.description}`).join('\n');

    const response = await llmWithTool.invoke([
      new SystemMessage(this.config.systemPrompt),
      new HumanMessage(this.config.planMessageTemplate(goal, toolDescriptions)),
    ]);

    // 从 tool_calls 中提取计划数据
    if (!response.tool_calls || response.tool_calls.length === 0) {
      throw new Error('LLM 未返回计划工具调用');
    }

    const toolCall = response.tool_calls[0];
    if (toolCall.name !== 'generate_plan') {
      throw new Error(`意外的工具调用: ${toolCall.name}`);
    }

    const planData = toolCall.args as z.infer<typeof PlanSchema>;

    return {
      goal: planData.goal,
      steps: planData.steps.map(step => ({
        id: step.id,
        description: step.description,
        status: 'pending' as const,
        requiredTools: step.requiredTools,
        dependencies: step.dependencies,
      })),
      reasoning: planData.reasoning,
      history: [],
    };
  }

  /**
   * 根据执行结果优化计划
   */
  private async refinePlan(
    plan: Plan,
    latestResult: string,
    tools: Tool[]
  ): Promise<PlanRefinement> {
    const llm = createLLM({
      model: this.config.plannerModel,
      provider: this.config.provider,
      apiKey: this.config.apiKey,
      baseUrl: this.config.baseUrl,
    });
    const structuredLLM = llm.withStructuredOutput(PlanRefinementSchema);

    const prompt = this.config.refineMessageTemplate(plan, latestResult, tools);

    const response = await structuredLLM.invoke([
      new SystemMessage(this.config.refinePrompt),
      new HumanMessage(prompt),
    ]);

    return response as PlanRefinement;
  }

  /**
   * 生成汇总计划执行的最终响应
   */
  private async generateFinalResponse(plan: Plan): Promise<string> {
    const llm = createLLM({
      model: this.config.plannerModel,
      provider: this.config.provider,
      apiKey: this.config.apiKey,
      baseUrl: this.config.baseUrl,
    });

    const response = await llm.invoke([
      new SystemMessage(this.config.summaryPrompt),
      new HumanMessage(this.config.summaryMessageTemplate(plan)),
    ]);

    return response.content as string;
  }

  /**
   * 生成友好的步骤提示消息
   */
  private async generateFriendlyMessage(stepDescription: string): Promise<string> {
    const llm = createLLM({
      model: this.config.plannerModel,
      provider: this.config.provider,
      apiKey: this.config.apiKey,
      baseUrl: this.config.baseUrl,
    });

    const response = await llm.invoke([
      new SystemMessage(
        '你是一个友好的助手。根据给定的任务描述，生成一条简短的中文提示消息（15字以内），告诉用户你正在做什么。语气要轻松友好，可以适当使用emoji。只返回提示消息本身，不要有其他内容。'
      ),
      new HumanMessage(`任务: ${stepDescription}`),
    ]);

    return (response.content as string).trim();
  }
}
