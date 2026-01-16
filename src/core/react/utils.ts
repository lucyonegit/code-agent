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

// ============================================================================
// 工具描述缓存
// ============================================================================

/** 工具描述缓存 */
const toolDescriptionCache = new Map<string, string>();

/**
 * 格式化工具描述（带缓存）
 * 当工具列表不变时，复用之前的格式化结果
 *
 * @param tools 工具列表
 * @returns 格式化后的工具描述
 */
export function formatToolDescriptionsCached(tools: Tool[]): string {
  // 生成缓存 key（基于工具名称排序）
  const cacheKey = tools.map(t => t.name).sort().join(',');

  const cached = toolDescriptionCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const result = formatToolDescriptions(tools);
  toolDescriptionCache.set(cacheKey, result);

  // 限制缓存大小，避免内存泄漏
  if (toolDescriptionCache.size > 100) {
    const firstKey = toolDescriptionCache.keys().next().value;
    if (firstKey) {
      toolDescriptionCache.delete(firstKey);
    }
  }

  return result;
}

/**
 * 清除工具描述缓存
 * 在工具定义变更时调用
 */
export function clearToolDescriptionCache(): void {
  toolDescriptionCache.clear();
}
