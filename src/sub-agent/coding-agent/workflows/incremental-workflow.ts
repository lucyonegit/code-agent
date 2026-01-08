/**
 * 增量修改工作流
 * 通过 projectId 加载项目，跳过 BDD 和架构，直接生成代码
 */

import { createFsCodeGenTool } from '../tools/codegen-fs';
import { getProjectTree } from '../services/template-generator';
import type {
  CodingAgentConfig,
  CodingAgentInput,
  CodingAgentEvent,
  BDDFeature,
  ArchitectureFile,
  CodeGenResult,
  GeneratedFile,
} from '../../types/index';

/**
 * 增量工作流上下文
 */
export interface IncrementalWorkflowContext {
  requirement: string;
  projectId: string;
  llmConfig: {
    model: string;
    provider: CodingAgentConfig['provider'];
    apiKey?: string;
    baseUrl?: string;
  };
  useRag?: boolean;
  onProgress?: CodingAgentInput['onProgress'];
}

/**
 * 增量工作流结果
 */
export interface IncrementalWorkflowResult {
  bddFeatures: BDDFeature[];
  architecture: ArchitectureFile[];
  codeResult?: CodeGenResult;
}

/**
 * 发出事件的辅助函数
 */
async function emitEvent(
  handler: CodingAgentInput['onProgress'],
  event: CodingAgentEvent
): Promise<void> {
  if (handler) await handler(event);
}

/**
 * 从项目树中收集文件列表
 */
function collectFilesFromTree(
  t: Record<string, unknown>,
  prefix = ''
): { path: string; content: string }[] {
  const files: { path: string; content: string }[] = [];

  for (const [name, node] of Object.entries(t)) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (typeof node === 'object' && node !== null) {
      if ('file' in node) {
        const fileNode = node as { file: { contents: string } };
        files.push({
          path,
          content: fileNode.file.contents,
        });
      } else if ('directory' in node) {
        const dirNode = node as { directory: Record<string, unknown> };
        files.push(...collectFilesFromTree(dirNode.directory, path));
      }
    }
  }

  return files;
}

/**
 * 构建最小增量架构（占位结构，让 LLM 自主通过 grep 决定修改哪些文件）
 */
function buildMinimalArchitecture(requirement: string): ArchitectureFile[] {
  // 只返回一个占位架构，实际修改由 LLM 通过 grep_files 自主决定
  return [
    {
      path: 'src/App.tsx', // 占位，LLM 会自行决定真正需要修改的文件
      type: 'component' as const,
      description: `增量修改: ${requirement}`,
      bdd_references: ['scenario_incremental'],
      status: 'pending_generation' as const,
      dependencies: [] as { path: string; import: string[] }[],
      rag_context_used: null,
      content: null,
    },
  ];
}

/**
 * 执行增量修改工作流
 */
export async function runIncrementalWorkflow(
  context: IncrementalWorkflowContext,
  results: IncrementalWorkflowResult
): Promise<void> {
  const { requirement, projectId, llmConfig, useRag, onProgress } = context;

  await emitEvent(onProgress, {
    type: 'phase_start',
    phase: 'codegen',
    message: '检测到项目上下文，正在进行增量修改...',
    timestamp: Date.now(),
  });

  // 从项目加载文件列表
  const projectFiles: GeneratedFile[] = [];

  try {
    const tree = await getProjectTree(projectId);
    projectFiles.push(...collectFilesFromTree(tree as Record<string, unknown>));
    console.log(
      `[IncrementalWorkflow] Loaded ${projectFiles.length} files from project ${projectId}`
    );
  } catch (loadError) {
    console.error(`[IncrementalWorkflow] Failed to load project files:`, loadError);
    throw new Error(`无法加载项目文件: ${projectId}`);
  }

  // 创建代码生成工具
  const codeGenTool = createFsCodeGenTool(
    { ...llmConfig, useRag },
    {
      existingProjectId: projectId,
      existingFiles: projectFiles,
    },
    async event => {
      await emitEvent(onProgress, event as unknown as CodingAgentEvent);
    }
  );

  // 增量模式：构造符合 Schema 的占位 BDD 结构
  const incrementalBDD: BDDFeature[] = [
    {
      feature_id: 'incremental_modification',
      feature_title: '增量代码修改',
      description: requirement,
      scenarios: [
        {
          id: 'scenario_incremental',
          title: '用户修改请求',
          given: ['存在现有项目代码'],
          when: ['用户请求修改'],
          then: ['代码按需求更新'],
        },
      ],
    },
  ];

  // 构建最小架构（让 LLM 自主决定修改哪些文件）
  const incrementalArchitecture = buildMinimalArchitecture(requirement);

  console.log(`[IncrementalWorkflow] Incremental mode: LLM will autonomously determine files to modify`);

  // 执行代码生成
  const rawResult = await codeGenTool.execute({
    bdd_scenarios: incrementalBDD,
    architecture: incrementalArchitecture,
  });

  // 解析结果
  try {
    const json = JSON.parse(rawResult);
    results.codeResult = {
      files: json.files || [],
      tree: json.tree,
      summary: json.summary || '',
      projectId: json.projectId,
    };

    // 发送 code_generated 事件
    await emitEvent(onProgress, {
      type: 'code_generated',
      files: results.codeResult!.files,
      tree: results.codeResult!.tree,
      summary: results.codeResult!.summary,
      timestamp: Date.now(),
    });

    await emitEvent(onProgress, {
      type: 'phase_complete',
      phase: 'codegen',
      data: json,
      timestamp: Date.now(),
    });
  } catch (e) {
    console.error('[IncrementalWorkflow] Error parsing incremental result:', e);
    throw new Error('代码生成结果解析失败');
  }
}
