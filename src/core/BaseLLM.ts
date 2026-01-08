import { ChatOpenAI } from '@langchain/openai';
import { config as dotenvConfig } from 'dotenv';
import type { LLMProvider } from '../types/index.js';

// 加载环境变量
dotenvConfig();

/**
 * 公司 LiteLLM 服务配置
 */
const LITE_LLM_CONFIG = {
  baseUrl: 'https://openkey.bantouyan.com/v1',
  apiKey: process.env.LITE_LLM_APIKEY || '',
};

/**
 * LLM 创建配置
 */
export interface LLMConfig {
  /** 模型名称 */
  model: string;
  /** 提供商 */
  provider: LLMProvider;
  /** 温度参数 */
  temperature?: number;
  /** API Key（可选，默认使用公司 LiteLLM 的 API Key） */
  apiKey?: string;
  /** 自定义 Base URL（可选，默认使用公司 LiteLLM） */
  baseUrl?: string;
  /** 是否启用流式输出 */
  streaming?: boolean;
}

/**
 * 创建 LLM 实例
 * 默认使用公司 LiteLLM 服务 (https://openkey.bantouyan.com)
 * @param config - LLM 配置
 */
export function createLLM(config: LLMConfig): ChatOpenAI {
  // 使用公司 LiteLLM 作为默认配置
  const apiKey = config.apiKey || LITE_LLM_CONFIG.apiKey;
  const baseUrl = config.baseUrl || LITE_LLM_CONFIG.baseUrl;

  const baseConfig = {
    model: config.model,
    temperature: config.temperature ?? 0,
    apiKey: apiKey,
    streaming: config.streaming,
  };

  switch (config.provider) {
    case 'tongyi':
      // 使用通义千问的 OpenAI 兼容端点（通过 LiteLLM 代理）
      return new ChatOpenAI({
        ...baseConfig,
        configuration: {
          baseURL: baseUrl,
        },
      });

    case 'claude':
      // 使用 Claude（通过 LiteLLM 代理）
      // 模型名格式: claude-3-5-sonnet-20241022, claude-3-opus-20240229 等
      return new ChatOpenAI({
        ...baseConfig,
        configuration: {
          baseURL: baseUrl,
        },
        supportsStrictToolCalling: true,
      });

    case 'gemini':
      // 使用 Gemini（通过 LiteLLM 代理）
      // 模型名格式: gemini-1.5-pro, gemini-1.5-flash 等
      return new ChatOpenAI({
        ...baseConfig,
        configuration: {
          baseURL: baseUrl,
        },
      });

    case 'openai-compatible':
      return new ChatOpenAI({
        ...baseConfig,
        configuration: {
          baseURL: baseUrl,
        },
      });

    case 'openai':
    default:
      // 所有请求都通过公司 LiteLLM 代理
      return new ChatOpenAI({
        ...baseConfig,
        configuration: {
          baseURL: baseUrl,
        },
      });
  }
}
