/**
 * 增量修改工作流
 * 通过 projectId 加载项目，跳过 BDD 和架构，直接生成代码
 */

import { createFsCodeGenTool } from '../tools/codegen-fs';
import { getProjectTree } from '../services/template-generator';
import { createLLM } from '../../../core/BaseLLM';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
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
 * 分析需要修改的文件
 */
async function analyzeFilesToModify(
  requirement: string,
  projectFiles: GeneratedFile[],
  llmConfig: IncrementalWorkflowContext['llmConfig']
): Promise<string[]> {
  // 构建文件列表供 LLM 分析
  const fileListText = projectFiles.map(f => `- ${f.path}`).join('\n');

  const llm = createLLM({
    model: llmConfig.model,
    provider: llmConfig.provider,
    apiKey: llmConfig.apiKey,
    baseUrl: llmConfig.baseUrl,
  });

  const analysisResponse = await llm.invoke([
    new SystemMessage(`你是代码修改分析专家。根据用户需求，分析需要修改哪些文件。
只返回需要修改的文件路径列表，每行一个路径。如果需要新建文件，也列出路径。
不要返回任何解释，只返回文件路径。`),
    new HumanMessage(`现有文件：
${fileListText}

用户修改需求：${requirement}

请列出需要修改或新建的文件路径（每行一个）：`),
  ]);

  const filesToModify = (analysisResponse.content as string)
    .split('\n')
    .map(line => line.trim().replace(/^[-*•]\s*/, ''))
    .filter(line => line.length > 0 && line.startsWith('src/'));

  console.log(`[IncrementalWorkflow] LLM decided to modify:`, filesToModify);

  return filesToModify;
}

/**
 * 构建增量架构
 */
function buildIncrementalArchitecture(
  filesToModify: string[],
  requirement: string
): ArchitectureFile[] {
  const architecture = filesToModify.map(filePath => ({
    path: filePath,
    type: 'component' as const,
    description: `修改: ${requirement}`,
    bdd_references: ['scenario_incremental'],
    status: 'pending_generation' as const,
    dependencies: [] as { path: string; import: string[] }[],
    rag_context_used: null,
    content: null,
  }));

  // 如果 LLM 没有识别到任何文件，默认修改 App.tsx
  if (architecture.length === 0) {
    console.log('[IncrementalWorkflow] No files identified, defaulting to App.tsx');
    architecture.push({
      path: 'src/App.tsx',
      type: 'component' as const,
      description: `修改: ${requirement}`,
      bdd_references: ['scenario_incremental'],
      status: 'pending_generation' as const,
      dependencies: [] as { path: string; import: string[] }[],
      rag_context_used: null,
      content: null,
    });
  }

  return architecture;
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

  // 分析需要修改的文件
  const filesToModify = await analyzeFilesToModify(requirement, projectFiles, llmConfig);

  // 构建增量架构
  const incrementalArchitecture = buildIncrementalArchitecture(filesToModify, requirement);

  console.log(
    `[IncrementalWorkflow] Incremental mode: modifying ${incrementalArchitecture.length} file(s)`
  );

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
