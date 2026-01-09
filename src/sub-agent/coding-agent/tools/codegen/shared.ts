/**
 * 共享工具函数
 * 用于新建项目和增量修改模式的公共逻辑
 */

import { existsSync, cpSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  initializeProjectDirectory,
  getTempProjectPath,
} from '../../services/template-generator';
import { getProjectDir } from '../fs';
import type { GeneratedFile } from '../../../types/index';

/**
 * 初始化项目目录
 * 支持新建项目和增量修改模式
 */
export async function setupProjectDirectory(
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
      console.log(`[Shared] Copying project from ${persistentPath} to ${tempPath}`);

      // 清理旧的临时目录（如果存在）
      if (existsSync(tempPath)) {
        rmSync(tempPath, { recursive: true });
      }

      // 拷贝整个项目目录
      cpSync(persistentPath, tempPath, { recursive: true });
      tempDir = tempPath;
      console.log(`[Shared] Project copied to temp directory: ${tempDir}`);
    } else if (existsSync(tempPath)) {
      tempDir = tempPath;
      console.log(`[Shared] Using existing temp project: ${tempDir}`);
    } else {
      console.log(`[Shared] Project ${projectId} not found, creating and restoring files`);
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
    console.log(`[Shared] Creating new project: ${projectId}`);
    tempDir = await initializeProjectDirectory(projectId);
  }

  return { projectId, tempDir };
}

/**
 * 收集生成的文件列表
 */
export function collectGeneratedFiles(tree: Record<string, unknown>): GeneratedFile[] {
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
