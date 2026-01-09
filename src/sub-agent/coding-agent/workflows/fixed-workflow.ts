/**
 * 固定工作流：BDD → Architect → CodeGen
 * 从 CodingAgent 提取的核心工作流实现
 */

import { createBDDTool } from '../tools/bdd';
import { createArchitectTool } from '../tools/architect';
import { createFsCodeGenTool } from '../tools/codegen';
import type {
  CodingAgentConfig,
  CodingAgentInput,
  CodingAgentEvent,
  BDDFeature,
  ArchitectureFile,
  CodeGenResult,
} from '../../types/index';
import type { Plan } from '../../../types/index';

/**
 * 工作流上下文
 */
export interface WorkflowContext {
  requirement: string;
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
 * 工作流结果
 */
export interface WorkflowResult {
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
 * 执行固定工作流：BDD → Architect → CodeGen
 * 程序化传递工具输出，绕过 LLM 参数传递问题
 */
export async function runFixedWorkflow(
  context: WorkflowContext,
  results: WorkflowResult
): Promise<void> {
  const { requirement, llmConfig, useRag, onProgress } = context;

  // 推送固定的 Plan 给前端
  const fixedPlan: Plan = {
    goal: requirement,
    steps: [
      { id: 'step_1', description: 'BDD 场景拆解', status: 'pending' },
      { id: 'step_2', description: '架构设计', status: 'pending' },
      { id: 'step_3', description: '代码生成', status: 'pending' },
    ],
    reasoning: '固定三步编码工作流',
    history: [],
  };

  await emitEvent(onProgress, {
    type: 'plan_update',
    plan: fixedPlan,
    timestamp: Date.now(),
  });

  // 创建三个工具实例
  const bddTool = createBDDTool(llmConfig);
  const architectTool = createArchitectTool(llmConfig);
  const codegenTool = createFsCodeGenTool(
    { ...llmConfig, useRag },
    async event => {
      await emitEvent(onProgress, event as unknown as CodingAgentEvent);
    }
  );

  // ========== Step 1: BDD 拆解 ==========
  await executeBDDStep(fixedPlan, bddTool, requirement, results, onProgress);

  // ========== Step 2: 架构设计 ==========
  await executeArchitectStep(fixedPlan, architectTool, results, onProgress);

  // ========== Step 3: 代码生成 ==========
  await executeCodeGenStep(fixedPlan, codegenTool, results, onProgress);
}

/**
 * 执行 BDD 拆解步骤
 */
async function executeBDDStep(
  plan: Plan,
  bddTool: ReturnType<typeof createBDDTool>,
  requirement: string,
  results: WorkflowResult,
  onProgress?: CodingAgentInput['onProgress']
): Promise<void> {
  plan.steps[0].status = 'in_progress';
  await emitEvent(onProgress, {
    type: 'plan_update',
    plan: { ...plan },
    timestamp: Date.now(),
  });

  await emitEvent(onProgress, {
    type: 'phase_start',
    phase: 'bdd',
    message: '正在拆解 BDD 场景...',
    timestamp: Date.now(),
  });

  const bddCallId = `bdd_${Date.now()}`;
  await emitEvent(onProgress, {
    type: 'tool_call',
    toolCallId: bddCallId,
    toolName: 'decompose_to_bdd',
    args: { requirement },
    timestamp: Date.now(),
  });

  const bddStartTime = Date.now();
  const bddResultRaw = await bddTool.execute({ requirement });
  const bddDuration = Date.now() - bddStartTime;

  await emitEvent(onProgress, {
    type: 'tool_call_result',
    toolCallId: bddCallId,
    toolName: 'decompose_to_bdd',
    result: bddResultRaw,
    success: true,
    duration: bddDuration,
    timestamp: Date.now(),
  });

  // 解析 BDD 结果
  const bddFeatures: BDDFeature[] = JSON.parse(bddResultRaw);
  results.bddFeatures = bddFeatures;

  await emitEvent(onProgress, {
    type: 'bdd_generated',
    features: bddFeatures,
    timestamp: Date.now(),
  });

  await emitEvent(onProgress, {
    type: 'phase_complete',
    phase: 'bdd',
    data: bddFeatures,
    timestamp: Date.now(),
  });

  plan.steps[0].status = 'done';
  plan.steps[0].result = `生成 ${bddFeatures.length} 个功能场景`;
  plan.history.push({
    stepId: 'step_1',
    result: bddResultRaw,
    toolName: 'decompose_to_bdd',
    resultType: 'json',
    timestamp: new Date(),
  });
}

/**
 * 执行架构设计步骤
 */
async function executeArchitectStep(
  plan: Plan,
  architectTool: ReturnType<typeof createArchitectTool>,
  results: WorkflowResult,
  onProgress?: CodingAgentInput['onProgress']
): Promise<void> {
  plan.steps[1].status = 'in_progress';
  await emitEvent(onProgress, {
    type: 'plan_update',
    plan: { ...plan },
    timestamp: Date.now(),
  });

  await emitEvent(onProgress, {
    type: 'phase_start',
    phase: 'architect',
    message: '正在设计项目架构...',
    timestamp: Date.now(),
  });

  const archCallId = `arch_${Date.now()}`;
  await emitEvent(onProgress, {
    type: 'tool_call',
    toolCallId: archCallId,
    toolName: 'design_architecture',
    args: { bdd_scenarios: results.bddFeatures },
    timestamp: Date.now(),
  });

  const archStartTime = Date.now();
  // 直接程序化传递 BDD 结果
  const archResultRaw = await architectTool.execute({ bdd_scenarios: results.bddFeatures });
  const archDuration = Date.now() - archStartTime;

  await emitEvent(onProgress, {
    type: 'tool_call_result',
    toolCallId: archCallId,
    toolName: 'design_architecture',
    result: archResultRaw,
    success: true,
    duration: archDuration,
    timestamp: Date.now(),
  });

  // 解析架构结果
  const architecture: ArchitectureFile[] = JSON.parse(archResultRaw);
  results.architecture = architecture;

  await emitEvent(onProgress, {
    type: 'architecture_generated',
    files: architecture,
    timestamp: Date.now(),
  });

  await emitEvent(onProgress, {
    type: 'phase_complete',
    phase: 'architect',
    data: architecture,
    timestamp: Date.now(),
  });

  plan.steps[1].status = 'done';
  plan.steps[1].result = `设计 ${architecture.length} 个文件`;
  plan.history.push({
    stepId: 'step_2',
    result: archResultRaw,
    toolName: 'design_architecture',
    resultType: 'json',
    timestamp: new Date(),
  });
}

/**
 * 执行代码生成步骤
 */
async function executeCodeGenStep(
  plan: Plan,
  codegenTool: ReturnType<typeof createFsCodeGenTool>,
  results: WorkflowResult,
  onProgress?: CodingAgentInput['onProgress']
): Promise<void> {
  plan.steps[2].status = 'in_progress';
  await emitEvent(onProgress, {
    type: 'plan_update',
    plan: { ...plan },
    timestamp: Date.now(),
  });

  await emitEvent(onProgress, {
    type: 'phase_start',
    phase: 'codegen',
    message: '正在生成代码...',
    timestamp: Date.now(),
  });

  const codegenCallId = `codegen_${Date.now()}`;
  await emitEvent(onProgress, {
    type: 'tool_call',
    toolCallId: codegenCallId,
    toolName: 'generate_code',
    args: { bdd_scenarios: results.bddFeatures, architecture: results.architecture },
    timestamp: Date.now(),
  });

  const codegenStartTime = Date.now();
  // 直接程序化传递 BDD 和架构结果
  let codegenResultRaw: string;
  try {
    codegenResultRaw = await codegenTool.execute({
      bdd_scenarios: results.bddFeatures,
      architecture: results.architecture,
    });
  } catch (codegenError) {
    const errorMsg = codegenError instanceof Error ? codegenError.message : String(codegenError);
    console.error('[FixedWorkflow] CodeGen tool execution failed:', errorMsg);
    console.error(
      '[FixedWorkflow] BDD count:',
      results.bddFeatures.length,
      'Arch count:',
      results.architecture.length
    );
    throw new Error(`代码生成失败: ${errorMsg}`);
  }
  const codegenDuration = Date.now() - codegenStartTime;

  await emitEvent(onProgress, {
    type: 'tool_call_result',
    toolCallId: codegenCallId,
    toolName: 'generate_code',
    result: codegenResultRaw,
    success: true,
    duration: codegenDuration,
    timestamp: Date.now(),
  });

  // 解析代码生成结果
  const codegenResult = JSON.parse(codegenResultRaw);
  results.codeResult = {
    files: codegenResult.files || [],
    tree: codegenResult.tree,
    summary: codegenResult.summary || '',
    projectId: codegenResult.projectId,
  };

  // 验证 tree 包含完整项目结构（包括 package.json 等模版文件）
  const treeKeys = Object.keys(codegenResult.tree || {});
  console.log('[FixedWorkflow] Tree contains:', treeKeys.join(', '));
  console.log('[FixedWorkflow] Has package.json:', 'package.json' in (codegenResult.tree || {}));

  await emitEvent(onProgress, {
    type: 'code_generated',
    files: results.codeResult.files,
    tree: results.codeResult.tree,
    summary: results.codeResult.summary,
    timestamp: Date.now(),
  });

  await emitEvent(onProgress, {
    type: 'phase_complete',
    phase: 'codegen',
    data: codegenResult,
    timestamp: Date.now(),
  });

  plan.steps[2].status = 'done';
  plan.steps[2].result = `生成 ${results.codeResult.files.length} 个代码文件`;

  // 发送最终的 plan_update
  await emitEvent(onProgress, {
    type: 'plan_update',
    plan: { ...plan },
    timestamp: Date.now(),
  });
}
