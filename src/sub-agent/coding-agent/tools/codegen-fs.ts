/**
 * 文件系统模式代码生成工具 v3.2
 * 使用 fs function call 将文件写入临时目录
 * 支持新项目创建和增量修改模式
 */

import { z } from 'zod';
import type { Tool, LLMProvider, ReActEvent } from '../../../types/index';
import { ReActExecutor } from '../../../core/react';
import {
  initializeProjectDirectory,
  readProjectTree,
  getTempProjectPath,
} from '../services/template-generator';
import {
  BDDFeatureSchema,
  BDDResultSchema,
  ArchitectureFileSchema,
  ArchitectureResultSchema,
  type BDDResult,
  type ArchitectureResult,
} from './schemas';
import type { GeneratedFile, CodingAgentEvent } from '../../types/index';
import { createWriteFileTool, createReadFileTool, createDeleteFileTool, getProjectDir } from './fs';
import { existsSync, cpSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { LogLevel } from '../../../core/ReActLogger';

// 从 codegen 子模块导入
import {
  CODE_GEN_SYSTEM_PROMPT,
  INCREMENTAL_SYSTEM_PROMPT,
  buildUserPrompt,
  buildIncrementalUserPrompt,
  topologicalSort,
  fetchRagContext,
  extractKeywords,
  createFinishToolAsFinalAnswer,
  handleNpmDependencies,
  parseNpmDependencies,
} from './codegen';

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

export interface FsCodeGenOptions {
  existingProjectId?: string; // 用于增量修改的已有项目 ID
  existingFiles?: GeneratedFile[]; // 现有文件内容
}

/**
 * 初始化项目目录
 */
async function setupProjectDirectory(
  existingProjectId: string | undefined,
  existingFiles: GeneratedFile[],
  isIncrementalMode: boolean
): Promise<{ projectId: string; tempDir: string }> {
  let projectId: string;
  let tempDir: string;

  if (isIncrementalMode && existingProjectId) {
    // 增量模式：从持久化目录拷贝到临时目录
    projectId = existingProjectId;
    const tempPath = getTempProjectPath(projectId);
    const persistentPath = getProjectDir(projectId);

    // 检查持久化目录是否存在
    if (existsSync(persistentPath)) {
      console.log(`[FsCodeGen] Copying project from ${persistentPath} to ${tempPath}`);

      // 清理旧的临时目录（如果存在）
      if (existsSync(tempPath)) {
        rmSync(tempPath, { recursive: true });
      }

      // 拷贝整个项目目录
      cpSync(persistentPath, tempPath, { recursive: true });
      tempDir = tempPath;
      console.log(`[FsCodeGen] Project copied to temp directory: ${tempDir}`);
    } else if (existsSync(tempPath)) {
      tempDir = tempPath;
      console.log(`[FsCodeGen] Using existing temp project: ${tempDir}`);
    } else {
      console.log(`[FsCodeGen] Project ${projectId} not found, creating and restoring files`);
      tempDir = await initializeProjectDirectory(projectId);
      // 恢复现有文件到新目录
      for (const file of existingFiles) {
        const filePath = join(tempDir, file.path);
        const dir = filePath.substring(0, filePath.lastIndexOf('/'));
        mkdirSync(dir, { recursive: true });
        writeFileSync(filePath, file.content, 'utf-8');
      }
    }
  } else {
    // 新项目模式
    projectId = `project_${Date.now()}`;
    console.log(`[FsCodeGen] Creating new project: ${projectId}`);
    tempDir = await initializeProjectDirectory(projectId);
  }

  return { projectId, tempDir };
}

/**
 * 收集生成的文件列表
 */
function collectGeneratedFiles(tree: Record<string, unknown>): GeneratedFile[] {
  const generatedFiles: GeneratedFile[] = [];

  function collect(t: Record<string, unknown>, prefix = '') {
    for (const [name, node] of Object.entries(t)) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (typeof node === 'object' && node !== null) {
        if ('file' in node) {
          const fileNode = node as { file: { contents: string } };
          generatedFiles.push({
            path,
            content: fileNode.file.contents,
          });
        } else if ('directory' in node) {
          const dirNode = node as { directory: Record<string, unknown> };
          collect(dirNode.directory, path);
        }
      }
    }
  }

  collect(tree);
  return generatedFiles;
}

/**
 * 创建文件系统模式的代码生成工具
 */
export function createFsCodeGenTool(
  config: LLMConfig,
  options: FsCodeGenOptions = {},
  onProgress?: CodeGenProgressCallback
): Tool {
  const { existingProjectId, existingFiles = [] } = options;

  return {
    name: 'generate_code_fs',
    description: `基于 BDD 场景和架构设计，使用文件系统工具生成项目代码。
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

      // 判断是新项目还是增量修改
      const isIncrementalMode = existingProjectId && existingFiles.length > 0;

      // 初始化项目目录
      const { projectId, tempDir } = await setupProjectDirectory(
        existingProjectId,
        existingFiles,
        !!isIncrementalMode
      );

      console.log(`[FsCodeGen] Project directory: ${tempDir}`);

      // 创建 fs 工具（绑定到项目目录）
      const fsTools: Tool[] = [
        createWriteFileTool(tempDir),
        createReadFileTool(tempDir),
        createDeleteFileTool(tempDir),
      ];

      // 获取 RAG 上下文
      let ragContext = '';
      if (config.useRag) {
        const keywords = extractKeywords(bddScenarios, archData);
        ragContext = await fetchRagContext(keywords);
      }

      // 构建提示词
      let systemPrompt: string;
      let userPrompt: string;

      if (isIncrementalMode) {
        // 增量模式
        systemPrompt = INCREMENTAL_SYSTEM_PROMPT;
        const filesToModify = archData.map(f => f.path);
        const requirement = bddData[0]?.description || '';
        const existingFilesSummary = existingFiles.map(f => `- ${f.path}`).join('\n');
        userPrompt = buildIncrementalUserPrompt(requirement, filesToModify, existingFilesSummary);
      } else {
        // 新项目模式
        systemPrompt = CODE_GEN_SYSTEM_PROMPT;
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
        userPrompt = buildUserPrompt(
          bddScenarios,
          archDescription,
          ragContext,
          existingTemplateFiles
        );
      }

      // 创建 ReActExecutor
      const maxIterations = isIncrementalMode ? archData.length + 15 : archData.length + 10;
      const executor = new ReActExecutor({
        model: config.model,
        provider: config.provider,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        maxIterations,
        systemPrompt,
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
      console.log(`[FsCodeGen] Generated tree keys: ${treeKeys.join(', ')}`);

      // 处理 npm 依赖变更
      await handleNpmDependencies(tree, npmDependencies, npmDependenciesToRemove, tempDir);

      // 收集生成的文件列表
      const generatedFiles = collectGeneratedFiles(tree as Record<string, unknown>);
      console.log(`[FsCodeGen] Collected ${generatedFiles.length} files`);
      console.log(
        `[FsCodeGen] First 5 files: ${generatedFiles
          .slice(0, 5)
          .map(f => f.path)
          .join(', ')}`
      );

      return JSON.stringify({
        tree,
        files: generatedFiles,
        projectId,
        summary,
      });
    },
  };
}
