/**
 * NPM 依赖处理模块
 */

import { writeFileSync } from 'fs';
import { join } from 'path';
import type { WebContainerTree, WebContainerFile } from '../../../types';

/**
 * 处理 NPM 依赖变更（添加和删除）
 */
export async function handleNpmDependencies(
  tree: WebContainerTree,
  npmDependencies: Record<string, string>,
  npmDependenciesToRemove: string[],
  tempDir: string
): Promise<void> {
  const hasAdditions = Object.keys(npmDependencies).length > 0;
  const hasRemovals = npmDependenciesToRemove.length > 0;

  if (!hasAdditions && !hasRemovals) {
    return;
  }

  const packageJsonNode = tree['package.json'] as WebContainerFile | undefined;
  if (!packageJsonNode?.file) {
    console.warn('[NpmHandler] package.json not found in tree');
    return;
  }

  try {
    const packageJson = JSON.parse(packageJsonNode.file.contents);
    if (!packageJson.dependencies) {
      packageJson.dependencies = {};
    }

    // 添加新依赖
    for (const [pkg, version] of Object.entries(npmDependencies)) {
      packageJson.dependencies[pkg] = version;
      console.log(`[NpmHandler] Adding npm dependency: ${pkg}@${version}`);
    }

    // 删除依赖
    for (const pkg of npmDependenciesToRemove) {
      if (packageJson.dependencies[pkg]) {
        delete packageJson.dependencies[pkg];
        console.log(`[NpmHandler] Removing npm dependency: ${pkg}`);
      }
      // 同时检查 devDependencies
      if (packageJson.devDependencies?.[pkg]) {
        delete packageJson.devDependencies[pkg];
        console.log(`[NpmHandler] Removing dev dependency: ${pkg}`);
      }
    }

    // 写回 package.json
    packageJsonNode.file.contents = JSON.stringify(packageJson, null, 2);

    // 同时写入文件系统
    writeFileSync(join(tempDir, 'package.json'), packageJsonNode.file.contents, 'utf-8');
    console.log('[NpmHandler] Updated package.json with dependency changes');
  } catch (e) {
    console.error('[NpmHandler] Failed to patch package.json:', e);
  }
}

/**
 * 解析 finish 工具返回的 npm 依赖信息
 */
export function parseNpmDependencies(result: string): {
  summary: string;
  npmDependencies: Record<string, string>;
  npmDependenciesToRemove: string[];
} {
  try {
    const parsed = JSON.parse(result);
    return {
      summary: parsed.summary || '代码生成完成',
      npmDependencies: parsed.npm_dependencies || {},
      npmDependenciesToRemove: parsed.npm_dependencies_to_remove || [],
    };
  } catch {
    return {
      summary: result || '代码生成完成',
      npmDependencies: {},
      npmDependenciesToRemove: [],
    };
  }
}
