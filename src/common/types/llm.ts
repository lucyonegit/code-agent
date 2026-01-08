/**
 * 统一 LLM 配置类型
 * 避免在各模块中重复定义
 */

import type { LLMProvider } from '../../types/index.js';

/**
 * LLM 配置接口
 * 用于创建 LLM 实例和配置工具
 */
export interface LLMConfig {
  /** 模型名称 */
  model: string;
  /** LLM 提供商 */
  provider: LLMProvider;
  /** API Key（可选，默认使用环境变量） */
  apiKey?: string;
  /** 自定义 Base URL（可选）*/
  baseUrl?: string;
  /** 温度参数（可选）*/
  temperature?: number;
  /** 是否启用流式输出（可选）*/
  streaming?: boolean;
}

/**
 * 带 RAG 选项的 LLM 配置
 * 用于代码生成等需要 RAG 上下文的场景
 */
export interface LLMConfigWithRag extends LLMConfig {
  /** 是否使用 RAG 获取组件文档 */
  useRag?: boolean;
}
