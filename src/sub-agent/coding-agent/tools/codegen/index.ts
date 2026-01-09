/**
 * 代码生成子模块统一导出
 */

// Prompt 和构建函数
export {
  CODE_GEN_SYSTEM_PROMPT,
  INCREMENTAL_SYSTEM_PROMPT,
  buildUserPrompt,
  buildIncrementalUserPrompt,
} from '../../config/prompt';

// 工具函数
export { topologicalSort, fetchRagContext, extractKeywords } from './utils';
export { createFinishToolAsFinalAnswer } from './finish-tool';
export { handleNpmDependencies, parseNpmDependencies } from './npm-handler';
export { setupProjectDirectory, collectGeneratedFiles } from './shared';

// 代码生成工具
export { createFsCodeGenTool, type CodeGenProgressCallback, type LLMConfig } from './create-project';
export {
  createIncrementalCodeGenTool,
  type IncrementalCodeGenProgressCallback,
  type IncrementalLLMConfig,
  type IncrementalProjectContext,
} from './modify-project';
