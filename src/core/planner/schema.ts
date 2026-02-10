/**
 * Planner Schema 定义
 *
 * 包含计划生成和优化相关的 Zod schema
 */

import { z } from 'zod';

/**
 * 计划优化输出的 Zod schema
 */
export const PlanRefinementSchema = z.object({
  shouldReplan: z.boolean().describe('计划是否需要调整'),
  reasoning: z.string().describe('决策的解释'),
  updatedSteps: z
    .array(
      z.object({
        id: z.string(),
        description: z.string(),
        requiredTools: z.array(z.string()).nullish(),
        status: z.enum(['pending', 'skipped']).nullish(),
      })
    )
    .nullish()
    .describe('如果需要重规划，更新后的剩余步骤'),
});

export type PlanRefinement = z.infer<typeof PlanRefinementSchema>;
