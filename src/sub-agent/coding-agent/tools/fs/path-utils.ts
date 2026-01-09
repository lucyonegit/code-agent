/**
 * 路径工具函数
 * 项目目录路径管理
 */

import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

/**
 * 获取项目根目录
 */
export function getProjectsRoot(): string {
  // agent/projects 目录
  return join(process.cwd(), 'projects');
}

/**
 * 获取临时项目目录
 */
export function getTempProjectDir(projectId: string): string {
  return join(getProjectsRoot(), '.temp', projectId);
}

/**
 * 获取持久化项目目录
 */
export function getProjectDir(projectId: string): string {
  return join(getProjectsRoot(), projectId);
}

/**
 * 确保目录存在
 */
export function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}
