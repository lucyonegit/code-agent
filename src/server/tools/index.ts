/**
 * 预定义工具注册
 */

import { z } from 'zod';
import type { Tool } from '../../types/index.js';
import {
  createRagSearchTool,
  createGetComponentListTool,
} from '../../sub-agent/coding-agent/tools/rag.js';

/**
 * 预定义工具集合
 */
export const AVAILABLE_TOOLS: Record<string, Tool> = {
  get_weather: {
    name: 'get_weather',
    description: '获取指定位置的当前天气信息',
    parameters: z.object({
      location: z.string().describe('要获取天气的城市或位置'),
      unit: z.enum(['celsius', 'fahrenheit']).nullable().optional().describe('温度单位'),
    }),
    execute: async args => {
      // 模拟天气 API
      return JSON.stringify({
        location: args.location,
        temperature: 25,
        unit: args.unit || 'celsius',
        condition: '晴天',
        humidity: 60,
      });
    },
  },
  calculator: {
    name: 'calculator',
    description: '执行数学计算',
    parameters: z.object({
      expression: z.string().describe('数学表达式'),
    }),
    execute: async args => {
      try {
        const sanitized = args.expression.replace(/[^0-9+\-*/().%\s]/g, '');
        const result = Function(`"use strict"; return (${sanitized})`)();
        return `${args.expression} = ${result}`;
      } catch {
        return `计算错误: ${args.expression}`;
      }
    },
  },
  web_search: {
    name: 'web_search',
    description: '搜索网络信息',
    parameters: z.object({
      query: z.string().describe('搜索关键词'),
    }),
    execute: async args => {
      // 模拟搜索 API
      return JSON.stringify([
        { title: `"${args.query}" 的搜索结果`, snippet: '这是一个示例搜索结果...' },
      ]);
    },
  },
  // RAG 工具
  search_component_docs: createRagSearchTool(),
  get_component_list: createGetComponentListTool(),
};

/**
 * 根据名称获取工具列表
 */
export function getToolsByNames(names: string[]): Tool[] {
  return names.filter(name => AVAILABLE_TOOLS[name]).map(name => AVAILABLE_TOOLS[name]);
}
