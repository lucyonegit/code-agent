/**
 * 增量代码修改工具
 * 专门用于对现有项目进行增量修改
 * 参数简化为只需要 requirement
 */

import { z } from 'zod';
import type { Tool, LLMProvider, ReActEvent } from '../../../../types/index';
import { ReActExecutor } from '../../../../core/react';
import { readProjectTree } from '../../services/template-generator';
import type { GeneratedFile, CodingAgentEvent } from '../../../types/index';
import {
  createWriteFileTool,
  createReadFileTool,
  createDeleteFileTool,
  createModifyFileTool,
  createListFilesTool,
  createGrepFilesTool,
  createReadFileLinesTool,
  createListSymbolsTool,
} from '../fs';
import { LogLevel } from '../../../../core/ReActLogger';
import {
  INCREMENTAL_SYSTEM_PROMPT,
  buildIncrementalUserPrompt,
  createFinishToolAsFinalAnswer,
  handleNpmDependencies,
  parseNpmDependencies,
  setupProjectDirectory,
  collectGeneratedFiles,
} from './index';

/**
 * 代码生成进度回调函数类型
 */
export type IncrementalCodeGenProgressCallback = (event: CodingAgentEvent) => void | Promise<void>;

export interface IncrementalLLMConfig {
  model: string;
  provider: LLMProvider;
  apiKey?: string;
  baseUrl?: string;
}

export interface IncrementalProjectContext {
  projectId: string;
  existingFiles: GeneratedFile[];
}

/**
 * 创建增量代码修改工具
 *
 * 相比 createFsCodeGenTool，此工具：
 * - 参数只需要 requirement（用户需求）
 * - 专门为增量修改场景优化
 * - 使用 INCREMENTAL_SYSTEM_PROMPT
 * - 配置完整的增量工具集（grep、read_file_lines、list_symbols 等）
 */
export function createIncrementalCodeGenTool(
  config: IncrementalLLMConfig,
  projectContext: IncrementalProjectContext,
  onProgress?: IncrementalCodeGenProgressCallback
): Tool {
  const { projectId, existingFiles } = projectContext;

  return {
    name: 'modify_code_incrementally',
    description: `根据用户需求增量修改现有项目代码。
使用 grep_files 搜索代码、read_file_lines 精准阅读、write_file 写入修改。`,
    returnType: 'json',
    parameters: z.object({
      requirement: z.string().describe('用户的代码修改需求'),
    }),
    execute: async args => {
      const { requirement } = args;

      console.log(`[ModifyProject] Starting incremental modification`);
      console.log(`[ModifyProject] Requirement: ${requirement}`);
      console.log(`[ModifyProject] Project: ${projectId}, Files: ${existingFiles.length}`);

      // 初始化项目目录（增量模式）
      const { projectId: finalProjectId, tempDir } = await setupProjectDirectory(
        projectId,
        existingFiles,
        true // 始终是增量模式
      );

      console.log(`[ModifyProject] Project directory: ${tempDir}`);

      // 创建增量模式完整工具集
      const fsTools: Tool[] = [
        // 探索工具
        createListFilesTool(tempDir),
        createGrepFilesTool(tempDir),
        createReadFileLinesTool(tempDir),
        createListSymbolsTool(tempDir),
        createReadFileTool(tempDir),
        // 修改工具
        createModifyFileTool(tempDir),  // 优先使用增量修改，减少 token
        createWriteFileTool(tempDir),   // 大范围修改时使用
        createDeleteFileTool(tempDir),
      ];

      // 构建用户提示词
      const existingFilesSummary = existingFiles.map(f => `- ${f.path}`).join('\n');
      const userPrompt = buildIncrementalUserPrompt(requirement, [], existingFilesSummary);

      // 创建 ReActExecutor
      const maxIterations = existingFiles.length + 15; // 给予足够的迭代次数
      const executor = new ReActExecutor({
        model: config.model,
        provider: config.provider,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        maxIterations,
        systemPrompt: INCREMENTAL_SYSTEM_PROMPT,
        finalAnswerTool: createFinishToolAsFinalAnswer(),
        streaming: true,
        logLevel: LogLevel.DEBUG,
      });

      // 执行 ReAct 循环
      let finalSummary = '';
      const result = await executor.run({
        input: userPrompt,
        tools: fsTools,
        onMessage: async (event: ReActEvent) => {
          if (onProgress) {
            // 转发事件
            if (event.type === 'thought') {
              await onProgress({
                type: 'thought',
                thoughtId: event.thoughtId,
                chunk: event.chunk,
                isComplete: event.isComplete,
                timestamp: event.timestamp,
              } as unknown as CodingAgentEvent);
            } else if (event.type === 'tool_call') {
              await onProgress({
                type: 'tool_call',
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                args: event.args as Record<string, unknown>,
                timestamp: event.timestamp,
              });
            } else if (event.type === 'tool_call_result') {
              await onProgress({
                type: 'tool_call_result',
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                result: String(event.result),
                success: event.success,
                duration: event.duration,
                timestamp: event.timestamp,
              });
            } else if (event.type === 'final_result') {
              finalSummary = event.content;
            }
          }
        },
      });

      // 解析最终摘要和 npm 依赖变更
      const { summary, npmDependencies, npmDependenciesToRemove } = parseNpmDependencies(
        finalSummary || result
      );

      // 读取生成的文件树
      const tree = await readProjectTree(tempDir);
      const treeKeys = Object.keys(tree);
      console.log(`[ModifyProject] Generated tree keys: ${treeKeys.join(', ')}`);

      // 处理 npm 依赖变更
      await handleNpmDependencies(tree, npmDependencies, npmDependenciesToRemove, tempDir);

      // 收集生成的文件列表
      const generatedFiles = collectGeneratedFiles(tree as Record<string, unknown>);
      console.log(`[ModifyProject] Collected ${generatedFiles.length} files`);

      return JSON.stringify({
        tree,
        files: generatedFiles,
        projectId: finalProjectId,
        summary,
      });
    },
  };
}
