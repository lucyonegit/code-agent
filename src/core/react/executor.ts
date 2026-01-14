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
  type Tool,
  type LLMProvider,
} from '../../types/index.js';

import {
  DEFAULT_REACT_PROMPT,
  DEFAULT_MAX_ITERATIONS,
  defaultFinalAnswerTool,
  defaultUserMessageTemplate,
  FINAL_ANSWER_PROMPT_SUFFIX,
} from './constants.js';
import { formatToolDescriptions } from './utils.js';
import { ToolHandler } from './tool-handler.js';
import { StreamHandler } from './stream-handler.js';

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
  };

  private logger: ReActLogger;

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
    };

    this.logger.debug('🔧 ReActExecutor 初始化', {
      model: this.config.model,
      provider: this.config.provider,
      maxIterations: this.config.maxIterations,
      streaming: this.config.streaming,
      logLevel: LogLevel[logLevel],
    });
  }

  /**
   * 执行 ReAct 循环
   */
  async run(input: ReActInput): Promise<string> {
    const { input: userInput, context, tools, onMessage, initialMessages } = input;
    const startTime = Date.now();

    const llm = createLLM({
      model: this.config.model,
      provider: this.config.provider,
      temperature: this.config.temperature,
      apiKey: this.config.apiKey,
      baseUrl: this.config.baseUrl,
      streaming: this.config.streaming,
    });

    // 最终答案工具始终使用内部默认实现
    const allTools = [...tools, defaultFinalAnswerTool];

    // 转换为 LangChain 工具格式并绑定
    const langChainTools = toolsToLangChain(allTools);
    const llmWithTools = llm.bindTools(langChainTools, {
      tool_choice: 'auto',
    });

    // 构建提示词的工具描述
    const toolDescriptions = formatToolDescriptions(tools);

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

    // 跟踪迭代历史和计数
    const iterationHistory: string[] = [];
    let completedIterations = 0;

    this.logger.separator();
    this.logger.info('🚀 ReAct 循环开始', {
      model: this.config.model,
      provider: this.config.provider,
      maxIterations: this.config.maxIterations,
      streaming: this.config.streaming,
      toolCount: tools.length,
    });

    // 初始化 Handler
    const toolHandler = new ToolHandler(allTools, this.logger, onMessage);
    const streamHandler = new StreamHandler(this.logger, onMessage);

    // 主 ReAct 循环
    for (let iteration = 1; iteration <= this.config.maxIterations; iteration++) {
      completedIterations = iteration;
      this.logger.info(`📍 迭代 ${iteration} 开始`, {
        iteration,
        messageCount: messages.length,
      });
      // 为本次迭代生成唯一的 thoughtId
      const iterationId = `thought_${Date.now()}_${iteration} `;

      try {
        let responseContent = '';
        let toolCalls: Array<{ id?: string; name: string; args: Record<string, any> }> = [];

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

        // 记录思考过程到历史
        if (responseContent) {
          iterationHistory.push(responseContent);
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
              type: 'final_result',
              content: result.answer,
              totalDuration,
              iterationCount: iteration,
              timestamp: Date.now(),
            };
            // ToolHandler handles message_sync, but final_result depends on executor context (duration/iteration)
            // So we emit final_result here. ToolHandler's handleFinalAnswer emitted the message_sync.
            await this.emitEvent(onMessage, finalEvent);
            return result.answer;
          } else if (result.type === 'continue') {
            messages.push(...result.messages);
            iterationHistory.push(...result.historyItems);
          }
        } else {
          // 没有工具调用 - 继续下一轮迭代
          this.logger.debug('🔄 迭代完成（无工具调用）', { iteration });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : '未知错误';
        this.logger.error(`迭代 ${iteration} 失败`, {
          iteration,
          error: errorMessage,
        });
        await this.emitEvent(onMessage, {
          type: 'error',
          message: `第 ${iteration} 次迭代失败: ${errorMessage} `,
          timestamp: Date.now(),
        });
        messages.push(new HumanMessage(`发生错误: ${errorMessage} \n请继续尝试。`));
      }

      // 防止无限循环：如果连续多次没有工具调用且输出为空
      // Check last message
      const lastMsg = messages[messages.length - 1];
      const isAIMessage = lastMsg instanceof AIMessage;
      const hasContent = typeof lastMsg.content === 'string' && lastMsg.content.length > 0;
      const hasToolCalls = isAIMessage && !!(lastMsg as AIMessage).tool_calls?.length;

      if (!hasContent && !hasToolCalls && !this.config.streaming) {
        // Streaming handles emptiness differently/mostly chunks
        this.logger.debug('🛑 空输出检测，跳出循环', {
          iteration: completedIterations,
          reason: '连续空输出且无工具调用',
        });
        break;
      }
    }

    // 达到最大迭代次数
    const totalDuration = Date.now() - startTime;
    this.logger.warn('⚠️ 达到最大迭代次数', {
      maxIterations: this.config.maxIterations,
      totalDuration: `${totalDuration}ms`,
    });
    const fallbackAnswer = `已达到最大迭代次数(${this.config.maxIterations})。\n\n${iterationHistory.join('\n\n')} `;
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
  private async emitEvent(handler: ReActInput['onMessage'], event: any): Promise<void> {
    this.logger.trace('📡 事件发射', {
      type: event.type,
      timestamp: event.timestamp,
    });
    if (handler) {
      await handler(event);
    }
  }
}
