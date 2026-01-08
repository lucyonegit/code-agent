/**
 * finish 工具定义
 * 用作 ReActExecutor 的 finalAnswerTool
 */

import { z } from 'zod';
import type { Tool } from '../../../../types/index';

/**
 * 创建 finish 工具
 * 包含 npm_dependencies 和 npm_dependencies_to_remove 参数用于管理第三方依赖
 */
export function createFinishToolAsFinalAnswer(): Tool {
  return {
    name: 'finish',
    description:
      '当所有文件生成/修改完毕时调用此工具。必须提供生成摘要，并声明 npm 依赖的添加和删除。',
    returnType: 'json',
    parameters: z.object({
      summary: z.string().optional().describe('生成摘要，说明生成、修改或删除了哪些文件'),
      answer: z.string().optional().describe('summary 的别名，用于兼容性'),
      npm_dependencies: z
        .record(z.string())
        .optional()
        .describe(
          '需要添加的第三方 npm 包及其版本，格式: {"包名": "^版本号"}。示例: {"three": "^0.160.0"}'
        ),
      npm_dependencies_to_remove: z
        .array(z.string())
        .optional()
        .describe(
          '需要移除的 npm 包名列表，当删除了使用某个包的所有代码时填写。示例: ["lodash", "axios"]'
        ),
    }),
    execute: async args => {
      return JSON.stringify({
        success: true,
        summary: args.summary || args.answer || 'Completed',
        npm_dependencies: args.npm_dependencies || {},
        npm_dependencies_to_remove: args.npm_dependencies_to_remove || [],
      });
    },
  };
}
