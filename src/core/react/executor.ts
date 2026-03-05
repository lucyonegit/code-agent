/**
 * ReActExecutor - 核心 ReAct 循环引擎
 */

import { HumanMessage, SystemMessage, AIMessage, type BaseMessage } from '@langchain/core/messages';
import { createLLM } from '../BaseLLM.js';
import { toolsToLangChain } from '../ToolRegistry.js';
import { convertToBaseMessages } from '../utils/messageConverter.js';
import { ReActLogger, LogLevel } from '../ReActLogger.js';
import {
  type ReActConfig,
  type ReActInput,
  type ReActEvent,
  type Tool,
  type LLMProvider,
} from '../../types/index.js';

import {
  DEFAULT_REACT_PROMPT,
  DEFAULT_MAX_ITERATIONS,
  defaultFinalAnswerTool,
  defaultUserMessageTemplate,
  FINAL_ANSWER_PROMPT_SUFFIX,
  DEFAULT_MAX_CONTEXT_TOKENS,
  DEFAULT_MAX_TOOL_RESULT_LENGTH,
  DEFAULT_STREAM_DELAY_MS,
} from './constants.js';
import { formatToolDescriptionsCached } from './utils.js';
import { ToolHandler } from './tool-handler.js';
import { StreamHandler } from './stream-handler.js';
import { ContextManager } from './context-manager.js';

import { join } from 'path';

export class ReActExecutor {
  private config: {
    model: string;
    provider: LLMProvider;
    maxIterations: number;
    systemPrompt: string;
    temperature: number;
    streaming: boolean;
    apiKey?: string;
    baseUrl?: string;
    userMessageTemplate: (input: string, toolDescriptions: string, context?: string) => string;
    logLevel: LogLevel;
    // 上下文管理配置
    maxContextTokens: number;
    enableCompression: boolean;
    maxToolResultLength: number;
    streamDelayMs: number;
  };

  private logger: ReActLogger;
  private contextManager: ContextManager;

  /** 缓存的 LLM 实例（配置不变时复用） */
  private cachedLLM: ReturnType<typeof createLLM> | null = null;
  private cachedLLMConfigHash: string = '';

  constructor(config: ReActConfig) {
    const logLevel = (config.logLevel ?? LogLevel.INFO) as LogLevel;

    // 日志文件路径：agent 根目录下的 logs 文件夹
    const logFilePath = join(process.cwd(), 'logs', 'react_session.txt');
    this.logger = new ReActLogger(logLevel, 'ReAct', logFilePath);

    this.config = {
      model: config.model,
      provider: config.provider ?? 'openai',
      maxIterations: config.maxIterations ?? DEFAULT_MAX_ITERATIONS,
      systemPrompt: config.systemPrompt ?? DEFAULT_REACT_PROMPT,
      temperature: config.temperature ?? 0,
      streaming: config.streaming ?? false,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      userMessageTemplate: config.userMessageTemplate ?? defaultUserMessageTemplate,
      logLevel,
      // 上下文管理配置
      maxContextTokens: config.maxContextTokens ?? DEFAULT_MAX_CONTEXT_TOKENS,
      enableCompression: config.enableCompression ?? true,
      maxToolResultLength: config.maxToolResultLength ?? DEFAULT_MAX_TOOL_RESULT_LENGTH,
      streamDelayMs: config.streamDelayMs ?? DEFAULT_STREAM_DELAY_MS,
    };

    // 初始化上下文管理器
    this.contextManager = new ContextManager({
      maxContextTokens: this.config.maxContextTokens,
      enableCompression: this.config.enableCompression,
      maxToolResultLength: this.config.maxToolResultLength,
      logger: this.logger,
    });

    this.logger.debug('🔧 ReActExecutor 初始化', {
      model: this.config.model,
      provider: this.config.provider,
      maxIterations: this.config.maxIterations,
      streaming: this.config.streaming,
      logLevel: LogLevel[logLevel],
      maxContextTokens: this.config.maxContextTokens,
      enableCompression: this.config.enableCompression,
    });
  }

  /**
   * 获取或创建 LLM 实例（配置不变时复用）
   */
  private getOrCreateLLM(): ReturnType<typeof createLLM> {
    const configHash = JSON.stringify({
      model: this.config.model,
      provider: this.config.provider,
      temperature: this.config.temperature,
      apiKey: this.config.apiKey,
      baseUrl: this.config.baseUrl,
      streaming: this.config.streaming,
    });

    if (this.cachedLLM && this.cachedLLMConfigHash === configHash) {
      this.logger.debug('♻️ 复用已有 LLM 实例');
      return this.cachedLLM;
    }

    this.cachedLLM = createLLM({
      model: this.config.model,
      provider: this.config.provider,
      temperature: this.config.temperature,
      apiKey: this.config.apiKey,
      baseUrl: this.config.baseUrl,
      streaming: this.config.streaming,
    });
    this.cachedLLMConfigHash = configHash;

    return this.cachedLLM;
  }

  /**
   * 执行 ReAct 循环
   */
  async run(input: ReActInput): Promise<string> {
    const { input: userInput, context, tools, onMessage, initialMessages } = input;
    const startTime = Date.now();

    const llm = this.getOrCreateLLM();

    // 最终答案工具始终使用内部默认实现
    const allTools = [...tools, defaultFinalAnswerTool];

    // 转换为 LangChain 工具格式并绑定
    const langChainTools = toolsToLangChain(allTools);
    const llmWithTools = llm.bindTools(langChainTools, {
      tool_choice: 'auto',
    });

    // 构建提示词的工具描述（带缓存）
    const toolDescriptions = formatToolDescriptionsCached(tools);

    // 构建系统提示词（始终添加最终答案工具使用说明）
    let systemPrompt = this.config.systemPrompt;
    systemPrompt += FINAL_ANSWER_PROMPT_SUFFIX(defaultFinalAnswerTool.name);

    // 初始化对话历史
    const messages: BaseMessage[] = [new SystemMessage(systemPrompt)];

    // 如果有历史消息，先转换并添加到消息列表
    if (initialMessages && initialMessages.length > 0) {
      const historyMessages = convertToBaseMessages(initialMessages);
      messages.push(...historyMessages);
      this.logger.debug('📜 历史消息加载', { count: initialMessages.length });
    }

    // 使用模板构建初始用户消息
    const userMessage = this.config.userMessageTemplate(userInput, toolDescriptions, context);
    messages.push(new HumanMessage(userMessage));

    // 跟踪迭代计数
    let completedIterations = 0;

    this.logger.separator();
    this.logger.info('🚀 ReAct 循环开始', {
      model: this.config.model,
      provider: this.config.provider,
      maxIterations: this.config.maxIterations,
      streaming: this.config.streaming,
      toolCount: tools.length,
    });

    // 初始化 Handler（传入 ContextManager 用于结果压缩）
    const toolHandler = new ToolHandler(allTools, this.logger, onMessage, this.contextManager);
    const streamHandler = new StreamHandler(this.logger, onMessage, {
      finalAnswerToolName: defaultFinalAnswerTool.name,
      streamDelayMs: this.config.streamDelayMs,
    });

    // 主 ReAct 循环
    for (let iteration = 1; iteration <= this.config.maxIterations; iteration++) {
      completedIterations = iteration;
      this.logger.info(`📍 迭代 ${iteration} 开始`, {
        iteration,
        messageCount: messages.length,
      });
      // 为本次迭代生成唯一的 thoughtId（修复尾部空格）
      const iterationId = `thought_${Date.now()}_${iteration}`;

      try {
        let responseContent = '';
        let toolCalls: Array<{ id?: string; name: string; args: Record<string, any> }> = [];

        // 步骤 0: 截断上下文以适应 Token 预算（每次迭代前检查）
        const truncatedMessages = this.contextManager.truncateMessages(messages);
        if (truncatedMessages.length < messages.length) {
          // 替换为截断后的消息（保持引用一致性）
          messages.length = 0;
          messages.push(...truncatedMessages);
        }

        // 步骤 1: 获取 LLM 响应（流式或非流式）
        if (this.config.streaming) {
          // === 流式模式 ===
          const result = await streamHandler.readStream(llmWithTools, messages, iterationId);
          responseContent = result.content;
          toolCalls = result.toolCalls;
          messages.push(result.message);
        } else {
          // === 非流式模式 ===
          const response = await llmWithTools.invoke(messages);
          responseContent = typeof response.content === 'string' ? response.content : '';

          if (response.tool_calls) {
            toolCalls = response.tool_calls.map(tc => ({
              id: tc.id,
              name: tc.name,
              args: tc.args,
            }));
          }

          // 发出思考事件 (Non-streaming)
          if (responseContent) {
            this.logger.debug('🧠 AI 响应内容', {
              contentLength: responseContent.length,
              contentPreview: responseContent.slice(0, 150),
            });
            await this.emitEvent(onMessage, {
              type: 'thought',
              thoughtId: iterationId,
              chunk: responseContent,
              isComplete: true,
              timestamp: Date.now(),
            });
          }

          messages.push(response);
        }

        // 步骤 2: 处理工具调用（统一逻辑）
        if (toolCalls.length > 0) {
          // 调试：打印解析后的工具调用
          this.logger.debug('🔧 工具调用检测', {
            count: toolCalls.length,
            tools: toolCalls.map(tc => tc.name),
          });

          const result = await toolHandler.handleToolCalls(
            toolCalls,
            defaultFinalAnswerTool.name
          );

          if (result.type === 'final_answer') {
            const totalDuration = Date.now() - startTime;
            this.logger.info('🎯 最终答案返回', {
              iterationCount: iteration,
              totalDuration: `${totalDuration}ms`,
              answerPreview: result.answer.slice(0, 100),
            });
            this.logger.separator();

            const finalEvent = {
              type: 'final_result' as const,
              content: result.answer,
              totalDuration,
              iterationCount: iteration,
              timestamp: Date.now(),
            };
            await this.emitEvent(onMessage, finalEvent);
            return result.answer;
          } else if (result.type === 'continue') {
            messages.push(...result.messages);
          }
        } else {
          // 没有工具调用 - 检测空输出以防无限循环
          this.logger.debug('🔄 迭代完成（无工具调用）', { iteration });

          const lastMsg = messages[messages.length - 1];
          const isAI = lastMsg instanceof AIMessage;
          const hasContent = typeof lastMsg.content === 'string' && lastMsg.content.length > 0;
          const hasTC = isAI && !!(lastMsg as AIMessage).tool_calls?.length;

          if (!hasContent && !hasTC && !this.config.streaming) {
            this.logger.debug('🛑 空输出检测，跳出循环', {
              iteration: completedIterations,
              reason: '连续空输出且无工具调用',
            });
            break;
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : '未知错误';
        this.logger.error(`迭代 ${iteration} 失败`, {
          iteration,
          error: errorMessage,
        });
        await this.emitEvent(onMessage, {
          type: 'error',
          message: `第 ${iteration} 次迭代失败: ${errorMessage}`,
          timestamp: Date.now(),
        });
        // 使用 SystemMessage 注入错误信息（而非 HumanMessage），避免混淆角色
        messages.push(new SystemMessage(`[系统提示] 上一次迭代发生错误: ${errorMessage}\n请继续尝试完成任务。`));
      }
    }

    // 达到最大迭代次数
    const totalDuration = Date.now() - startTime;
    this.logger.warn('⚠️ 达到最大迭代次数', {
      maxIterations: this.config.maxIterations,
      totalDuration: `${totalDuration}ms`,
    });

    // 从 messages 中提取最近的 AI 消息作为 fallback
    const aiMessages = messages.filter(m => m instanceof AIMessage);
    const lastAIContent = aiMessages.length > 0
      ? (typeof aiMessages[aiMessages.length - 1].content === 'string'
        ? aiMessages[aiMessages.length - 1].content
        : '')
      : '';

    const fallbackAnswer = `已达到最大迭代次数(${this.config.maxIterations})。\n\n${lastAIContent}`;
    await this.emitEvent(onMessage, {
      type: 'final_result',
      content: fallbackAnswer,
      totalDuration,
      iterationCount: completedIterations,
      timestamp: Date.now(),
    });
    return fallbackAnswer;
  }

  /**
   * 发出事件 (Internal helper)
   */
  private async emitEvent(handler: ReActInput['onMessage'], event: ReActEvent): Promise<void> {
    this.logger.trace('📡 事件发射', {
      type: event.type,
      timestamp: event.timestamp,
    });
    if (handler) {
      await handler(event);
    }
  }
}
