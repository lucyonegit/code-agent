/**
 * Planner 辅助函数
 *
 * 包含消息模板和计划操作的纯函数
 */

import type { Plan, PlanStep, Tool } from '../../types/index.js';

// ============================================================================
// 消息模板
// ============================================================================

/**
 * 默认计划生成消息模板
 */
export const defaultPlanMessageTemplate = (goal: string, toolDescriptions: string): string =>
  `目标: ${goal}\n\n可用工具:\n${toolDescriptions}\n\n创建一个分步计划来实现这个目标。你必须调用 generate_plan 工具来返回你的计划。`;

/**
 * 默认重规划消息模板
 */
export const defaultRefineMessageTemplate = (
  plan: Plan,
  latestResult: string,
  tools: Tool[]
): string => {
  const completedSteps = plan.steps.filter(s => s.status === 'done');
  const pendingSteps = plan.steps.filter(s => s.status === 'pending');

  return `目标: ${plan.goal}

已完成步骤:
${completedSteps.map(s => `- ${s.id}: ${s.description}\n  结果: ${s.result}`).join('\n')}

最新结果: ${latestResult}

剩余步骤:
${pendingSteps.map(s => `- ${s.id}: ${s.description}`).join('\n')}

可用工具: ${tools.map(t => t.name).join(', ')}

根据最新执行结果，剩余计划是否需要调整？`;
};

/**
 * 默认汇总消息模板
 */
export const defaultSummaryMessageTemplate = (plan: Plan): string => {
  const stepSummaries = plan.steps
    .filter(s => s.status === 'done')
    .map(s => `步骤 ${s.id}: ${s.description}\n结果: ${s.result}`)
    .join('\n\n');

  return `原始目标: ${plan.goal}\n\n已完成步骤:\n${stepSummaries}\n\n提供一个回答用户原始目标的最终摘要。`;
};

// ============================================================================
// 计划操作辅助函数
// ============================================================================

/**
 * 检查计划是否完成
 */
export function isPlanComplete(plan: Plan): boolean {
  return plan.steps.every(step => step.status === 'done' || step.status === 'skipped');
}

/**
 * 获取下一个待执行的步骤
 */
export function getNextStep(plan: Plan): PlanStep | undefined {
  return plan.steps.find(step => {
    if (step.status !== 'pending') return false;
    if (step.dependencies?.length) {
      return step.dependencies.every(depId => {
        const depStep = plan.steps.find(s => s.id === depId);
        return depStep?.status === 'done';
      });
    }
    return true;
  });
}

/**
 * 获取特定步骤相关的工具
 */
export function getToolsForStep(step: PlanStep, allTools: Tool[]): Tool[] {
  if (step.requiredTools?.length) {
    return allTools.filter(t => step.requiredTools!.includes(t.name));
  }
  return [];
}

/**
 * 格式化计划上下文，始终包含原始目标
 */
export function formatPlanHistory(plan: Plan): string {
  // 始终包含原始目标，这是最重要的上下文
  let context = `## 原始用户需求\n${plan.goal}\n`;

  // 如果有之前步骤的结果，也加入上下文
  if (plan.history.length > 0) {
    context += `\n## 之前步骤的执行结果\n`;

    for (const entry of plan.history) {
      const step = plan.steps.find(s => s.id === entry.stepId);
      const toolInfo = entry.toolName ? ` (工具: ${entry.toolName})` : '';
      context += `### 步骤 ${entry.stepId}: ${step?.description || '未知'}${toolInfo}\n`;

      // 根据返回类型动态格式化结果
      switch (entry.resultType) {
        case 'json':
          context += `**结果数据 (JSON 格式，可直接作为参数使用):**\n`;
          context += `\`\`\`json\n${entry.result}\n\`\`\`\n\n`;
          break;
        case 'code':
          context += `**代码结果:**\n`;
          context += `\`\`\`\n${entry.result}\n\`\`\`\n\n`;
          break;
        case 'markdown':
          context += `**结果:**\n${entry.result}\n\n`;
          break;
        case 'text':
        default:
          context += `**结果:** ${entry.result}\n\n`;
          break;
      }
    }
  }

  return context;
}
