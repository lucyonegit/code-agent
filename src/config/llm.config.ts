/**
 * LLM 模型配置
 *
 * 所有模型配置集中管理，通过环境变量覆盖，避免写死在业务代码中。
 *
 * 可用环境变量：
 * - DEFAULT_MODEL            默认模型（默认: claude-sonnet-4-20250514）
 * - DEFAULT_PROVIDER         默认提供商（默认: claude）
 * - CODING_MODEL             Coding Agent 模型（默认: 同 DEFAULT_MODEL）
 * - CODING_PROVIDER          Coding Agent 提供商（默认: 同 DEFAULT_PROVIDER）
 * - REACT_MODEL              ReAct 执行器模型（默认: 同 DEFAULT_MODEL）
 * - REACT_PROVIDER           ReAct 执行器提供商（默认: 同 DEFAULT_PROVIDER）
 * - PLANNER_MODEL            Planner 模型（默认: 同 DEFAULT_MODEL）
 * - PLANNER_PROVIDER         Planner 提供商（默认: 同 DEFAULT_PROVIDER）
 * - GREETING_MODEL           Greeting 生成模型（默认: gemini-2.5-flash）
 * - GREETING_PROVIDER        Greeting 生成提供商（默认: gemini）
 * - SIMPLE_QUERY_MODEL       简单查询模型（默认: gemini-2.5-flash）
 * - SIMPLE_QUERY_PROVIDER    简单查询提供商（默认: gemini）
 */

import type { LLMProvider } from '../types/index.js';

function getEnv(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

const DEFAULT_MODEL = getEnv('DEFAULT_MODEL', 'gemini-3-flash-preview');
const DEFAULT_PROVIDER = getEnv('DEFAULT_PROVIDER', 'gemini') as LLMProvider;

export const llmConfig = {
  /** Coding Agent 默认配置 */
  coding: {
    model: getEnv('CODING_MODEL', DEFAULT_MODEL),
    provider: (getEnv('CODING_PROVIDER', DEFAULT_PROVIDER)) as LLMProvider,
  },

  /** ReAct 执行器默认配置 */
  react: {
    model: getEnv('REACT_MODEL', DEFAULT_MODEL),
    provider: (getEnv('REACT_PROVIDER', DEFAULT_PROVIDER)) as LLMProvider,
  },

  /** Planner 默认配置 */
  planner: {
    model: getEnv('PLANNER_MODEL', DEFAULT_MODEL),
    provider: (getEnv('PLANNER_PROVIDER', DEFAULT_PROVIDER)) as LLMProvider,
  },

  /** Greeting 生成专用配置（轻量任务，默认使用 gemini-flash） */
  greeting: {
    model: getEnv('GREETING_MODEL', 'gemini-2.5-flash'),
    provider: (getEnv('GREETING_PROVIDER', 'gemini')) as LLMProvider,
  },

  /** 简单查询专用配置（轻量任务，默认使用 gemini-flash） */
  simpleQuery: {
    model: getEnv('SIMPLE_QUERY_MODEL', 'gemini-2.5-flash'),
    provider: (getEnv('SIMPLE_QUERY_PROVIDER', 'gemini')) as LLMProvider,
  },
} as const;
