/**
 * 增量修改工作流
 * 通过 projectId 加载项目，使用独立的增量代码生成工具
 */

import { createIncrementalCodeGenTool } from '../tools/codegen';
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
 * 执行增量修改工作流
 */
export async function runIncrementalWorkflow(
  context: IncrementalWorkflowContext,
  results: IncrementalWorkflowResult
): Promise<void> {
  const { requirement, projectId, llmConfig, onProgress } = context;

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

  // 创建增量代码修改工具（简化的接口，只需 requirement）
  const incrementalTool = createIncrementalCodeGenTool(
    llmConfig,
    {
      projectId,
      existingFiles: projectFiles,
    },
    async event => {
      await emitEvent(onProgress, event as unknown as CodingAgentEvent);
    }
  );

  console.log(`[IncrementalWorkflow] Using incremental code gen tool`);
  console.log(`[IncrementalWorkflow] Requirement: ${requirement}`);

  // 执行增量代码生成（只需传入 requirement）
  const rawResult = await incrementalTool.execute({ requirement });

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
