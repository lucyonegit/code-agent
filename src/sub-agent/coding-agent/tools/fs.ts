/**
 * 文件系统工具模块
 * 提供 list_files, read_file, write_file, delete_file 四个 function call 工具
 * 用于 LLM 通过工具调用的方式操作文件系统
 */

import { z } from 'zod';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  readdirSync,
  statSync,
  rmSync,
} from 'fs';
import { join, dirname } from 'path';
import type { Tool } from '../../../types/index';

/**
 * 获取项目根目录
 */
function getProjectsRoot(): string {
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
function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * 文件信息接口
 */
export interface FileInfo {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  children?: FileInfo[];
}

/**
 * 递归列出目录下的文件
 */
function listFilesRecursive(dirPath: string, basePath: string = ''): FileInfo[] {
  const result: FileInfo[] = [];

  if (!existsSync(dirPath)) {
    return result;
  }

  const entries = readdirSync(dirPath);

  for (const entry of entries) {
    // 跳过 node_modules 和隐藏文件
    if (entry === 'node_modules' || entry.startsWith('.')) {
      continue;
    }

    const fullPath = join(dirPath, entry);
    const relativePath = basePath ? `${basePath}/${entry}` : entry;
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      result.push({
        name: entry,
        path: relativePath,
        isDirectory: true,
        children: listFilesRecursive(fullPath, relativePath),
      });
    } else {
      result.push({
        name: entry,
        path: relativePath,
        isDirectory: false,
        size: stat.size,
      });
    }
  }

  return result;
}

/**
 * 创建 list_files 工具
 * 列出指定目录下的文件和子目录
 */
export function createListFilesTool(projectDir: string): Tool {
  return {
    name: 'list_files',
    description: '列出项目目录下的文件和子目录结构',
    parameters: z.object({
      directory: z
        .string()
        .optional()
        .describe('要列出的目录路径，相对于项目根目录。如果不指定则列出整个项目'),
    }),
    returnType: 'json',
    execute: async args => {
      const targetDir = args.directory ? join(projectDir, args.directory) : projectDir;

      if (!existsSync(targetDir)) {
        return JSON.stringify({
          success: false,
          error: `目录不存在: ${args.directory || '/'}`,
        });
      }

      const files = listFilesRecursive(targetDir, args.directory || '');

      return JSON.stringify({
        success: true,
        directory: args.directory || '/',
        files,
      });
    },
  };
}

/**
 * 创建 read_file 工具
 * 读取指定文件的内容
 */
export function createReadFileTool(projectDir: string): Tool {
  return {
    name: 'read_file',
    description: '读取指定文件的内容',
    parameters: z.object({
      path: z.string().describe('文件路径，相对于项目根目录，如 src/App.tsx'),
    }),
    returnType: 'json',
    execute: async args => {
      const filePath = join(projectDir, args.path);

      if (!existsSync(filePath)) {
        return JSON.stringify({
          success: false,
          error: `文件不存在: ${args.path}`,
        });
      }

      try {
        const content = readFileSync(filePath, 'utf-8');
        return JSON.stringify({
          success: true,
          path: args.path,
          content,
        });
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: `读取文件失败: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    },
  };
}

/**
 * 创建 write_file 工具
 * 写入文件内容到指定路径
 */
export function createWriteFileTool(projectDir: string): Tool {
  return {
    name: 'write_file',
    description: '写入文件内容到指定路径。如果文件不存在则创建，如果存在则覆盖。',
    parameters: z.object({
      path: z.string().describe('文件路径，相对于项目根目录，如 src/components/Button.tsx'),
      content: z.string().describe('要写入的文件内容'),
    }),
    returnType: 'json',
    execute: async args => {
      // 增强调试：打印接收到的完整 args
      console.log(`[fs:write_file] 接收到的 args:`, JSON.stringify(args, null, 2).slice(0, 500));
      console.log(`[fs:write_file] args 类型:`, typeof args);
      console.log(`[fs:write_file] args.path:`, args?.path);
      console.log(`[fs:write_file] args.content 长度:`, args?.content?.length);

      // 防御性检查：确保 args 存在
      if (!args || typeof args !== 'object') {
        console.error(`[fs:write_file] 错误: args 无效`, args);
        return JSON.stringify({
          success: false,
          error: `写入文件失败: 参数对象无效。请确保传入 {path: "文件路径", content: "文件内容"}`,
        });
      }

      // 防御性检查：确保 path 参数存在
      if (!args.path || typeof args.path !== 'string') {
        console.error(`[fs:write_file] 错误: path 参数为空或无效, path=${args.path}`);
        return JSON.stringify({
          success: false,
          error: `写入文件失败: path 参数不能为空。请提供要写入的文件路径，如 src/App.tsx`,
        });
      }

      const filePath = join(projectDir, args.path);

      // 防御性检查：确保 content 参数存在
      if (args.content === undefined || args.content === null) {
        console.error(`[fs:write_file] 错误: content 参数为空, path=${args.path}`);
        return JSON.stringify({
          success: false,
          error: `写入文件失败: content 参数不能为空。请提供要写入的文件内容。`,
        });
      }

      try {
        // 确保父目录存在
        const parentDir = dirname(filePath);
        ensureDir(parentDir);

        // 处理转义字符：将 LLM 返回的转义字符转换为实际字符
        // LLM 有时会在字符串中保留 JSON 转义形式，如 \" 而不是真正的 "
        let processedContent = args.content;

        // 策略1: 如果没有真正的换行符但有转义的 \n，进行完整反转义
        const hasNoRealNewlines = !processedContent.includes('\n');
        const hasEscapedNewlines = processedContent.includes('\\n');

        if (hasNoRealNewlines && hasEscapedNewlines) {
          console.log(`[fs:write_file] 检测到完整转义内容，进行反转义: ${args.path}`);
          processedContent = processedContent
            .replace(/\\n/g, '\n')
            .replace(/\\t/g, '\t')
            .replace(/\\r/g, '\r')
            .replace(/\\"/g, '"')
            .replace(/\\'/g, "'")
            .replace(/\\\\/g, '\\');
        } else {
          // 策略2: 即使有真正的换行符，也要检查是否有残留的转义引号
          // 这种情况通常是 LLM 返回的混合内容
          if (processedContent.includes('\\"')) {
            console.log(`[fs:write_file] 检测到残留转义引号，进行清理: ${args.path}`);
            processedContent = processedContent.replace(/\\"/g, '"');
          }
        }

        // 写入文件
        writeFileSync(filePath, processedContent, 'utf-8');

        console.log(
          `[fs:write_file] 写入文件成功: ${args.path} (${processedContent.length} chars)`
        );

        return JSON.stringify({
          success: true,
          path: args.path,
          size: args.content.length,
        });
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: `写入文件失败: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    },
  };
}

/**
 * 创建 delete_file 工具
 * 删除指定文件
 */
export function createDeleteFileTool(projectDir: string): Tool {
  return {
    name: 'delete_file',
    description: '删除指定的文件或目录',
    parameters: z.object({
      path: z.string().describe('要删除的文件或目录路径，相对于项目根目录'),
    }),
    returnType: 'json',
    execute: async args => {
      const targetPath = join(projectDir, args.path);

      if (!existsSync(targetPath)) {
        return JSON.stringify({
          success: false,
          error: `路径不存在: ${args.path}`,
        });
      }

      try {
        const stat = statSync(targetPath);

        if (stat.isDirectory()) {
          rmSync(targetPath, { recursive: true });
        } else {
          unlinkSync(targetPath);
        }

        console.log(`[fs:delete_file] 删除: ${args.path}`);

        return JSON.stringify({
          success: true,
          path: args.path,
        });
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: `删除失败: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    },
  };
}
