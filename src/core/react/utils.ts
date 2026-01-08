/**
 * ReAct Agent 工具函数
 */

import { type Tool } from '../../types/index.js';

/**
 * 格式化工具描述，用于构建提示词
 */
export function formatToolDescriptions(tools: Tool[]): string {
  return tools
    .map(tool => {
      const schemaShape = tool.parameters.shape;
      const paramsDescription = Object.entries(schemaShape)
        .map(([key, schema]) => {
          const zodSchema = schema as { description?: string; _def?: { typeName: string } };
          const type = zodSchema._def?.typeName?.replace('Zod', '') || 'any';
          const desc = zodSchema.description || '';
          return `    - ${key} (${type}): ${desc} `;
        })
        .join('\n');

      return `- ${tool.name}: ${tool.description} \n  参数: \n${paramsDescription} `;
    })
    .join('\n\n');
}
