/**
 * 项目生命周期管理服务
 */

import {
  readFileSync,
  readdirSync,
  statSync,
  existsSync,
  mkdirSync,
  renameSync,
  writeFileSync,
  rmSync,
} from 'fs';
import { join } from 'path';
import type {
  WebContainerTree,
  WebContainerFile,
  WebContainerDirectory,
} from '../../types';
import { getViteTemplate, type TemplateConfig } from './template-generator';

/**
 * 项目信息接口
 */
export interface ProjectInfo {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  path: string;
}

/**
 * 项目元数据
 */
interface ProjectMetadata {
  name: string;
  createdAt: string;
  updatedAt: string;
  framework: string;
}

/**
 * 获取项目根目录
 */
function getProjectsRoot(): string {
  return join(process.cwd(), 'projects');
}

/**
 * 获取临时项目目录路径
 */
export function getTempProjectPath(projectId: string): string {
  return join(getProjectsRoot(), '.temp', projectId);
}

/**
 * 获取持久化项目目录路径
 */
export function getProjectPath(projectId: string): string {
  return join(getProjectsRoot(), projectId);
}

/**
 * 递归读取目录并转换为 WebContainerTree
 */
function directoryToTree(dirPath: string): WebContainerTree {
  const tree: WebContainerTree = {};
  const entries = readdirSync(dirPath);

  for (const entry of entries) {
    // 跳过 node_modules 和 .git
    if (entry === 'node_modules' || entry === '.git') {
      continue;
    }

    const fullPath = join(dirPath, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      tree[entry] = {
        directory: directoryToTree(fullPath),
      } as WebContainerDirectory;
    } else if (stat.isFile()) {
      try {
        const content = readFileSync(fullPath, 'utf-8');
        tree[entry] = {
          file: {
            contents: content,
          },
        } as WebContainerFile;
      } catch {
        // 跳过无法读取的文件
      }
    }
  }

  return tree;
}

/**
 * 将 WebContainerTree 写入到目录
 */
async function writeTreeToDirectory(tree: WebContainerTree, dirPath: string): Promise<void> {
  for (const [name, node] of Object.entries(tree)) {
    const fullPath = join(dirPath, name);

    if ('directory' in node) {
      // 创建目录
      if (!existsSync(fullPath)) {
        mkdirSync(fullPath, { recursive: true });
      }
      // 递归写入子目录
      await writeTreeToDirectory(node.directory, fullPath);
    } else if ('file' in node) {
      // 写入文件
      writeFileSync(fullPath, node.file.contents, 'utf-8');
    }
  }
}

/**
 * 初始化项目目录并生成 Vite 模版
 * 在 agent/projects/.temp/{projectId}/ 下创建项目
 */
export async function initializeProjectDirectory(
  projectId: string,
  config: TemplateConfig = { framework: 'react-ts' }
): Promise<string> {
  const tempDir = getTempProjectPath(projectId);

  console.log(`[ProjectManager] Initializing project directory: ${tempDir}`);

  // 确保目录存在
  if (!existsSync(tempDir)) {
    mkdirSync(tempDir, { recursive: true });
  }

  // 获取模版
  const template = await getViteTemplate(config);

  // 将模版写入到临时目录
  await writeTreeToDirectory(template, tempDir);

  // 创建项目元数据文件
  const metadata: ProjectMetadata = {
    name: `Project ${projectId}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    framework: config.framework,
  };
  writeFileSync(join(tempDir, 'project.json'), JSON.stringify(metadata, null, 2));

  console.log(`[ProjectManager] Project initialized: ${projectId}`);

  return tempDir;
}

/**
 * 读取项目目录并转换为 WebContainerTree
 */
export async function readProjectTree(projectDir: string): Promise<WebContainerTree> {
  if (!existsSync(projectDir)) {
    throw new Error(`Project directory does not exist: ${projectDir}`);
  }

  return directoryToTree(projectDir);
}

/**
 * 将临时项目持久化
 * 从 .temp/{projectId} 移动到 {projectId}
 */
export async function persistProject(projectId: string, projectName?: string): Promise<string> {
  const tempDir = getTempProjectPath(projectId);
  const targetDir = getProjectPath(projectId);

  if (!existsSync(tempDir)) {
    throw new Error(`Temp project does not exist: ${projectId}`);
  }

  console.log(`[ProjectManager] Persisting project: ${projectId}`);

  // 确保目标目录的父目录存在
  const projectsRoot = getProjectsRoot();
  if (!existsSync(projectsRoot)) {
    mkdirSync(projectsRoot, { recursive: true });
  }

  // 如果目标目录已存在，先删除它（支持覆盖/增量更新后的持久化）
  if (existsSync(targetDir)) {
    console.log(`[ProjectManager] Target directory already exists, removing: ${targetDir}`);
    rmSync(targetDir, { recursive: true, force: true });
  }

  // 移动目录
  renameSync(tempDir, targetDir);

  // 更新项目元数据
  const metadataPath = join(targetDir, 'project.json');
  if (existsSync(metadataPath)) {
    try {
      const metadata: ProjectMetadata = JSON.parse(readFileSync(metadataPath, 'utf-8'));
      metadata.name = projectName || metadata.name;
      metadata.updatedAt = new Date().toISOString();
      writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    } catch (e) {
      console.error('[ProjectManager] Failed to update metadata:', e);
    }
  }

  console.log(`[ProjectManager] Project persisted: ${projectId} -> ${targetDir}`);

  return targetDir;
}

/**
 * 获取所有已保存的项目列表
 */
export async function listProjects(): Promise<ProjectInfo[]> {
  const projectsRoot = getProjectsRoot();
  const projects: ProjectInfo[] = [];

  if (!existsSync(projectsRoot)) {
    return projects;
  }

  const entries = readdirSync(projectsRoot);

  for (const entry of entries) {
    // 跳过临时目录和隐藏文件
    if (entry === '.temp' || entry.startsWith('.')) {
      continue;
    }

    const projectPath = join(projectsRoot, entry);
    const stat = statSync(projectPath);

    if (!stat.isDirectory()) {
      continue;
    }

    // 读取项目元数据
    const metadataPath = join(projectPath, 'project.json');
    let metadata: ProjectMetadata | null = null;

    if (existsSync(metadataPath)) {
      try {
        metadata = JSON.parse(readFileSync(metadataPath, 'utf-8'));
      } catch {
        // 忽略解析错误
      }
    }

    projects.push({
      id: entry,
      name: metadata?.name || entry,
      createdAt: metadata?.createdAt || stat.birthtime.toISOString(),
      updatedAt: metadata?.updatedAt || stat.mtime.toISOString(),
      path: projectPath,
    });
  }

  // 按更新时间倒序排序
  projects.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  return projects;
}

/**
 * 获取指定项目的文件树
 */
export async function getProjectTree(projectId: string): Promise<WebContainerTree> {
  // 先尝试持久化目录
  let projectDir = getProjectPath(projectId);

  if (!existsSync(projectDir)) {
    // 尝试临时目录
    projectDir = getTempProjectPath(projectId);
  }

  if (!existsSync(projectDir)) {
    throw new Error(`Project not found: ${projectId}`);
  }

  return readProjectTree(projectDir);
}

/**
 * 获取项目信息
 */
export async function getProjectInfo(projectId: string): Promise<ProjectInfo | null> {
  // 先尝试持久化目录
  let projectDir = getProjectPath(projectId);

  if (!existsSync(projectDir)) {
    projectDir = getTempProjectPath(projectId);
  }

  if (!existsSync(projectDir)) {
    return null;
  }

  const stat = statSync(projectDir);
  const metadataPath = join(projectDir, 'project.json');
  let metadata: ProjectMetadata | null = null;

  if (existsSync(metadataPath)) {
    try {
      metadata = JSON.parse(readFileSync(metadataPath, 'utf-8'));
    } catch {
      // 忽略解析错误
    }
  }

  return {
    id: projectId,
    name: metadata?.name || projectId,
    createdAt: metadata?.createdAt || stat.birthtime.toISOString(),
    updatedAt: metadata?.updatedAt || stat.mtime.toISOString(),
    path: projectDir,
  };
}

/**
 * 清理临时项目目录
 */
export async function cleanupTempDirectory(projectId: string): Promise<void> {
  const tempDir = getTempProjectPath(projectId);

  if (existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
    console.log(`[ProjectManager] Cleaned up temp directory: ${projectId}`);
  }
}

/**
 * 删除项目
 */
export async function deleteProject(projectId: string): Promise<boolean> {
  // 尝试删除持久化目录
  const projectDir = getProjectPath(projectId);
  if (existsSync(projectDir)) {
    rmSync(projectDir, { recursive: true, force: true });
    console.log(`[ProjectManager] Deleted project: ${projectId}`);
    return true;
  }

  // 尝试删除临时目录
  const tempDir = getTempProjectPath(projectId);
  if (existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
    console.log(`[ProjectManager] Deleted temp project: ${projectId}`);
    return true;
  }

  return false;
}
