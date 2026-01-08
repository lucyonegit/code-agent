/**
 * 工作流模块统一导出
 */

export { runFixedWorkflow } from './fixed-workflow';
export type { WorkflowContext, WorkflowResult } from './fixed-workflow';

export { runIncrementalWorkflow } from './incremental-workflow';
export type { IncrementalWorkflowContext, IncrementalWorkflowResult } from './incremental-workflow';
