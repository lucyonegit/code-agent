/**
 * Tools 统一导出入口
 * 所有工具从此处导入
 */

// 三阶段工作流工具
export { createBDDTool, BDDResultSchema } from './bdd';
export { createArchitectTool, ArchitectureResultSchema, validateArchitecture } from './architect';

// 代码生成工具
export {
  createFsCodeGenTool,
  createIncrementalCodeGenTool,
  type CodeGenProgressCallback,
  type LLMConfig,
  type IncrementalCodeGenProgressCallback,
  type IncrementalLLMConfig,
  type IncrementalProjectContext,
} from './codegen';

// 文件系统工具
export {
  getProjectsRoot,
  getTempProjectDir,
  getProjectDir,
  ensureDir,
  createListFilesTool,
  createReadFileTool,
  createWriteFileTool,
  createDeleteFileTool,
  createGrepFilesTool,
  createReadFileLinesTool,
  createListSymbolsTool,
  type FileInfo,
} from './fs';

// Schema 定义
export * from './schemas';
