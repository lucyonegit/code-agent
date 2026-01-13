/**
 * 文件系统工具函数
 */

import { readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * 递归统计目录下的文件数量（排除 node_modules 和隐藏文件）
 * @param dirPath 目录路径
 * @returns 文件数量
 */
export function countProjectFiles(dirPath: string): number {
  if (!existsSync(dirPath)) {
    return 0;
  }

  const countRecursive = (dir: string): number => {
    let count = 0;
    try {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        // 跳过 node_modules 和隐藏文件
        if (entry === 'node_modules' || entry.startsWith('.')) {
          continue;
        }

        const fullPath = join(dir, entry);
        try {
          const stat = statSync(fullPath);
          if (stat.isDirectory()) {
            count += countRecursive(fullPath);
          } else {
            count++;
          }
        } catch {
          // 忽略权限错误等
        }
      }
    } catch (error) {
      console.warn(`[countProjectFiles] 无法读取目录 ${dir}:`, error);
    }
    return count;
  };

  return countRecursive(dirPath);
}