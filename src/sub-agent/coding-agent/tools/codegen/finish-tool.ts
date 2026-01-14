/**
 * coding_complete 工具定义
 * 用于标记代码生成/修改完成，并收集 npm 依赖变更信息
 * 注意：这是一个普通工具，不再作为 ReActExecutor 的 finalAnswerTool
 */

import { z } from 'zod';
import type { Tool } from '../../../../types/index';

/**
 * 创建 coding_complete 工具
 * 包含 npm_dependencies 和 npm_dependencies_to_remove 参数用于管理第三方依赖
 * 调用此工具后，LLM 应继续调用 give_final_answer 来总结工作
 */
export function createCodingCompleteTool(): Tool {
  return {
    name: 'coding_complete',
    description:
      '当所有文件生成/修改完毕后调用此工具，声明 npm 依赖变更。调用此工具后，应继续调用 give_final_answer 工具来总结本次工作。',
    returnType: 'json',
    parameters: z.object({
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
        message: 'Code generation/modification completed. Please call give_final_answer to summarize.',
        npm_dependencies: args.npm_dependencies || {},
        npm_dependencies_to_remove: args.npm_dependencies_to_remove || [],
      });
    },
  };
}
