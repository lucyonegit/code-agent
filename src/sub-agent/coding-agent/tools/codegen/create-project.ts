/**
 * 新项目代码生成工具 v4.0
 * 基于 BDD 和架构设计创建新项目
 */

import { z } from 'zod';
import type { Tool, LLMProvider, ReActEvent } from '../../../../types/index';
import { ReActExecutor } from '../../../../core/react';
import {
  initializeProjectDirectory,
  readProjectTree,
} from '../../services/template-generator';
import {
  BDDFeatureSchema,
  BDDResultSchema,
  ArchitectureFileSchema,
  ArchitectureResultSchema,
  type BDDResult,
  type ArchitectureResult,
} from '../schemas';
import type { CodingAgentEvent } from '../../../types/index';
import {
  createWriteFileTool,
  createReadFileTool,
  createDeleteFileTool,
} from '../fs';
import { LogLevel } from '../../../../core/ReActLogger';
import {
  CODE_GEN_SYSTEM_PROMPT,
  buildUserPrompt,
  topologicalSort,
  fetchRagContext,
  extractKeywords,
  createCodingCompleteTool,
  handleNpmDependencies,
  parseNpmDependencies,
  collectGeneratedFiles,
} from './index';
import {
  conversationStorage,
  ConversationCollector,
} from '../../services/conversation-manager';

/**
 * 代码生成进度回调函数类型
 */
export type CodeGenProgressCallback = (event: CodingAgentEvent) => void | Promise<void>;

export interface LLMConfig {
  model: string;
  provider: LLMProvider;
  apiKey?: string;
  baseUrl?: string;
  useRag?: boolean;
}

/**
 * 创建文件系统模式的代码生成工具
 * 专门用于新项目创建
 */
export function createFsCodeGenTool(
  config: LLMConfig,
  onProgress?: CodeGenProgressCallback
): Tool {
  return {
    name: 'generate_code_fs',
    description: `基于 BDD 场景和架构设计，使用文件系统工具生成新项目代码。
文件会被写入到临时目录，然后返回文件树 JSON。`,
    returnType: 'json',
    parameters: z.object({
      bdd_scenarios: z.array(BDDFeatureSchema).describe('BDD 场景数组'),
      architecture: z.array(ArchitectureFileSchema).describe('架构设计数组'),
    }),
    execute: async args => {
      // Zod 验证
      const bddValidation = BDDResultSchema.safeParse(args.bdd_scenarios);
      if (!bddValidation.success) {
        const errors = bddValidation.error.issues
          .map(issue => `[${issue.path.join('.')}] ${issue.message}`)
          .join('; ');
        throw new Error(`bdd_scenarios 格式验证失败: ${errors}`);
      }

      const archValidation = ArchitectureResultSchema.safeParse(args.architecture);
      if (!archValidation.success) {
        const errors = archValidation.error.issues
          .map(issue => `[${issue.path.join('.')}] ${issue.message}`)
          .join('; ');
        throw new Error(`architecture 格式验证失败: ${errors}`);
      }

      const bddData: BDDResult = bddValidation.data;
      const archData: ArchitectureResult = archValidation.data;
      const bddScenarios = JSON.stringify(bddData, null, 2);

      // 创建新项目
      const projectId = `project_${Date.now()}`;
      console.log(`[CreateProject] Creating new project: ${projectId}`);
      const tempDir = await initializeProjectDirectory(projectId);
      console.log(`[CreateProject] Project directory: ${tempDir}`);

      // 创建基础 fs 工具
      const fsTools: Tool[] = [
        createWriteFileTool(tempDir),
        createReadFileTool(tempDir),
        createDeleteFileTool(tempDir),
        createCodingCompleteTool(),  // 作为普通工具，用于收集 npm 依赖
      ];

      // 获取 RAG 上下文
      let ragContext = '';
      if (config.useRag) {
        const keywords = extractKeywords(bddScenarios, archData);
        ragContext = await fetchRagContext(keywords);
      }

      // 构建提示词（新项目模式）
      const sortedArch = topologicalSort(archData);
      const existingTemplateFiles = [
        'package.json',
        'vite.config.ts',
        'tsconfig.json',
        'index.html',
        'src/main.tsx',
        'src/index.css',
        'src/App.css',
      ];
      const archDescription = sortedArch
        .map(f => `- ${f.path} (${f.type}): ${f.description}`)
        .join('\n');
      const userPrompt = buildUserPrompt(
        bddScenarios,
        archDescription,
        ragContext,
        existingTemplateFiles
      );

      // 创建 ReActExecutor
      const maxIterations = archData.length + 10;
      const executor = new ReActExecutor({
        model: config.model,
        provider: config.provider,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        maxIterations,
        systemPrompt: CODE_GEN_SYSTEM_PROMPT,
        streaming: true,
        logLevel: LogLevel.DEBUG,
      });

      // 对话收集器
      const collector = new ConversationCollector();

      // 添加初始需求描述
      const bddSummary = bddData.map(f => f.feature_title).join(', ');
      collector.addUserMessage(`创建新项目: ${bddSummary}`);

      // 执行 ReAct 循环
      let finalSummary = '';
      // 用于从 coding_complete 工具结果中捕获 npm 依赖
      let capturedNpmDependencies: Record<string, string> = {};
      let capturedNpmDependenciesToRemove: string[] = [];

      const result = await executor.run({
        input: userPrompt,
        tools: fsTools,
        onMessage: async (event: ReActEvent) => {
          if (onProgress) {
            if (event.type === 'thought') {
              // 收集思考
              collector.handleThought(event.thoughtId, event.chunk, event.isComplete);
              await onProgress({
                type: 'thought',
                thoughtId: event.thoughtId,
                chunk: event.chunk,
                isComplete: event.isComplete,
                timestamp: event.timestamp,
              } as unknown as CodingAgentEvent);
            } else if (event.type === 'tool_call') {
              // 收集工具调用（包含 args）
              collector.handleToolCall(
                event.toolCallId,
                event.toolName,
                event.args as Record<string, unknown>
              );
              await onProgress({
                type: 'tool_call',
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                args: event.args as Record<string, unknown>,
                timestamp: event.timestamp,
              });
            } else if (event.type === 'tool_call_result') {
              // 收集工具结果
              collector.handleToolCallResult(
                event.toolCallId,
                event.toolName,
                String(event.result),
                event.success,
                event.duration
              );
              await onProgress({
                type: 'tool_call_result',
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                result: String(event.result),
                success: event.success,
                duration: event.duration,
                timestamp: event.timestamp,
              });

              // 捕获 coding_complete 工具的 npm 依赖信息
              if (event.toolName === 'coding_complete' && event.success) {
                try {
                  const resultObj = JSON.parse(String(event.result));
                  if (resultObj.npm_dependencies) {
                    capturedNpmDependencies = resultObj.npm_dependencies;
                  }
                  if (resultObj.npm_dependencies_to_remove) {
                    capturedNpmDependenciesToRemove = resultObj.npm_dependencies_to_remove;
                  }
                } catch (e) {
                  console.warn('[CreateProject] Failed to parse coding_complete result:', e);
                }
              }
            } else if (event.type === 'final_result') {
              finalSummary = event.content;
              await onProgress({
                type: 'final_result',
                content: event.content,
                timestamp: event.timestamp,
              });
            } else if (event.type === 'final_answer_stream') {
              await onProgress({
                type: 'final_answer_stream',
                answerId: event.answerId,
                chunk: event.chunk,
                isComplete: event.isComplete,
                timestamp: event.timestamp,
              });
            }
          }
        },
      });

      // 使用捕获的 npm 依赖（优先）或从最终摘要解析
      let npmDependencies = capturedNpmDependencies;
      let npmDependenciesToRemove = capturedNpmDependenciesToRemove;
      let summary = finalSummary || result;

      // 如果没有捕获到，尝试从 finalSummary 解析（向后兼容）
      if (Object.keys(npmDependencies).length === 0 && npmDependenciesToRemove.length === 0) {
        const parsed = parseNpmDependencies(finalSummary || result);
        npmDependencies = parsed.npmDependencies;
        npmDependenciesToRemove = parsed.npmDependenciesToRemove;
        summary = parsed.summary;
      }

      // 读取生成的文件树
      const tree = await readProjectTree(tempDir);
      const treeKeys = Object.keys(tree);
      console.log(`[CreateProject] Generated tree keys: ${treeKeys.join(', ')}`);

      // 处理 npm 依赖变更
      await handleNpmDependencies(tree, npmDependencies, npmDependenciesToRemove, tempDir);

      // 收集生成的文件列表
      const generatedFiles = collectGeneratedFiles(tree as Record<string, unknown>);
      console.log(`[CreateProject] Collected ${generatedFiles.length} files`);

      // 添加最终结果消息
      if (summary) {
        collector.addFinalResult(summary);
      }

      // 保存对话记录
      try {
        await conversationStorage.appendMessages(projectId, collector.getMessages());
        console.log(`[CreateProject] Saved ${collector.getMessages().length} messages to conversation`);
      } catch (e) {
        console.error(`[CreateProject] Failed to save conversation:`, e);
      }

      return JSON.stringify({
        tree,
        files: generatedFiles,
        projectId,
        summary,
      });
    },
  };
}
