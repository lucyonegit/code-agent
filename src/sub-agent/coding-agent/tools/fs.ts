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

        // 处理转义字符：修复 LLM 可能产生的双重转义问题
        // LLM 有时会在 JSON 参数中额外转义，导致 \\n 而不是 \n
        let processedContent = args.content;

        // 检测双重转义的模式：\\n \\t \\r \\" 等
        const hasDoubleEscapedNewline = processedContent.includes('\\\\n');
        const hasDoubleEscapedTab = processedContent.includes('\\\\t');
        const hasDoubleEscapedQuote = processedContent.includes('\\\\"');
        const hasDoubleEscape = hasDoubleEscapedNewline || hasDoubleEscapedTab || hasDoubleEscapedQuote;

        if (hasDoubleEscape) {
          console.log(`[fs:write_file] 检测到双重转义字符，进行修复: ${args.path}`);
          processedContent = processedContent
            .replace(/\\\\n/g, '\n')
            .replace(/\\\\t/g, '\t')
            .replace(/\\\\r/g, '\r')
            .replace(/\\\\"/g, '"')
            .replace(/\\\\'/g, "'");
        }

        // 策略1: 如果没有真正的换行符但有单层转义 \n，进行反转义
        const hasNoRealNewlines = !processedContent.includes('\n');
        const hasSingleEscapedNewlines = processedContent.includes('\\n');

        if (hasNoRealNewlines && hasSingleEscapedNewlines) {
          console.log(`[fs:write_file] 检测到完整转义内容，进行反转义: ${args.path}`);
          processedContent = processedContent
            .replace(/\\n/g, '\n')
            .replace(/\\t/g, '\t')
            .replace(/\\r/g, '\r')
            .replace(/\\"/g, '"')
            .replace(/\\'/g, "'")
            .replace(/\\\\/g, '\\');
        } else {
          // 策略2: 检查残留的转义引号
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

/**
 * 递归搜索文件内容
 */
function searchInDirectory(
  dirPath: string,
  pattern: RegExp,
  basePath: string,
  includes: string[],
  maxResults: number,
  results: { path: string; line: number; content: string }[]
): void {
  if (results.length >= maxResults) return;
  if (!existsSync(dirPath)) return;

  const entries = readdirSync(dirPath);

  for (const entry of entries) {
    if (results.length >= maxResults) break;

    // 跳过 node_modules 和隐藏文件
    if (entry === 'node_modules' || entry.startsWith('.')) {
      continue;
    }

    const fullPath = join(dirPath, entry);
    const relativePath = basePath ? `${basePath}/${entry}` : entry;

    try {
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        searchInDirectory(fullPath, pattern, relativePath, includes, maxResults, results);
      } else {
        // 检查文件类型过滤
        if (includes.length > 0) {
          const matchesInclude = includes.some(inc => {
            const glob = inc.replace(/\*/g, '.*');
            return new RegExp(`^${glob}$`).test(entry);
          });
          if (!matchesInclude) continue;
        }

        // 读取文件并搜索
        const content = readFileSync(fullPath, 'utf-8');
        const lines = content.split('\n');

        for (let i = 0; i < lines.length && results.length < maxResults; i++) {
          if (pattern.test(lines[i])) {
            results.push({
              path: relativePath,
              line: i + 1,
              content: lines[i].trim().slice(0, 200), // 截断过长的行
            });
          }
        }
      }
    } catch {
      // 忽略读取错误
    }
  }
}

/**
 * 创建 grep_files 工具
 * 在项目中搜索匹配的代码行
 */
export function createGrepFilesTool(projectDir: string): Tool {
  return {
    name: 'grep_files',
    description:
      '在项目中搜索匹配的代码行。返回匹配行的文件路径、行号和内容。适合快速定位代码位置。',
    parameters: z.object({
      pattern: z.string().describe('搜索词或正则表达式'),
      directory: z
        .string()
        .optional()
        .describe('搜索目录，相对于项目根目录，默认搜索整个项目'),
      include: z
        .array(z.string())
        .optional()
        .describe('文件类型过滤，如 ["*.tsx", "*.css"]，默认搜索所有文件'),
      maxResults: z.number().optional().describe('最大结果数，默认 50'),
    }),
    returnType: 'json',
    execute: async args => {
      const searchDir = args.directory ? join(projectDir, args.directory) : projectDir;
      const includes = args.include || [];
      const maxResults = args.maxResults || 50;

      if (!existsSync(searchDir)) {
        return JSON.stringify({
          success: false,
          error: `目录不存在: ${args.directory || '/'}`,
        });
      }

      try {
        // 尝试将 pattern 解析为正则，如果失败则作为普通字符串
        let regex: RegExp;
        try {
          regex = new RegExp(args.pattern, 'i');
        } catch {
          regex = new RegExp(args.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        }

        const results: { path: string; line: number; content: string }[] = [];
        searchInDirectory(searchDir, regex, args.directory || '', includes, maxResults, results);

        console.log(`[fs:grep_files] Found ${results.length} matches for "${args.pattern}"`);

        return JSON.stringify({
          success: true,
          pattern: args.pattern,
          totalMatches: results.length,
          matches: results,
        });
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: `搜索失败: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    },
  };
}

/**
 * 创建 read_file_lines 工具
 * 读取文件的指定行范围
 */
export function createReadFileLinesTool(projectDir: string): Tool {
  return {
    name: 'read_file_lines',
    description:
      '读取文件的指定行范围。适合在 grep_files 找到关键代码后，获取更多上下文。行号从 1 开始。',
    parameters: z.object({
      path: z.string().describe('文件路径，相对于项目根目录'),
      startLine: z.number().describe('起始行号（1-indexed，包含）'),
      endLine: z.number().describe('结束行号（包含）'),
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
        const lines = content.split('\n');
        const totalLines = lines.length;

        // 验证行号范围
        const startLine = Math.max(1, args.startLine);
        const endLine = Math.min(totalLines, args.endLine);

        if (startLine > endLine) {
          return JSON.stringify({
            success: false,
            error: `无效的行范围: ${startLine}-${endLine}`,
          });
        }

        // 提取指定行（转为 0-indexed）
        const selectedLines = lines.slice(startLine - 1, endLine);
        const selectedContent = selectedLines.join('\n');

        console.log(`[fs:read_file_lines] Read ${args.path} lines ${startLine}-${endLine}`);

        return JSON.stringify({
          success: true,
          path: args.path,
          startLine,
          endLine,
          totalLines,
          content: selectedContent,
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
 * 简单的符号提取（基于正则）
 */
interface CodeSymbol {
  name: string;
  type: 'function' | 'class' | 'const' | 'let' | 'var' | 'interface' | 'type' | 'export';
  line: number;
  signature: string;
}

function extractSymbols(content: string): CodeSymbol[] {
  const symbols: CodeSymbol[] = [];
  const lines = content.split('\n');

  const patterns: { regex: RegExp; type: CodeSymbol['type'] }[] = [
    // function declarations
    { regex: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/, type: 'function' },
    // arrow functions assigned to const
    { regex: /^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/, type: 'function' },
    // class declarations
    { regex: /^(?:export\s+)?class\s+(\w+)/, type: 'class' },
    // interface declarations
    { regex: /^(?:export\s+)?interface\s+(\w+)/, type: 'interface' },
    // type declarations
    { regex: /^(?:export\s+)?type\s+(\w+)/, type: 'type' },
    // const declarations (non-function)
    { regex: /^(?:export\s+)?const\s+(\w+)\s*(?::\s*[^=]+)?\s*=\s*(?!.*=>)/, type: 'const' },
    // default export
    { regex: /^export\s+default\s+(?:function\s+)?(\w+)/, type: 'export' },
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    for (const { regex, type } of patterns) {
      const match = line.match(regex);
      if (match) {
        symbols.push({
          name: match[1],
          type,
          line: i + 1,
          signature: line.slice(0, 100), // 截断过长的签名
        });
        break; // 每行只匹配一个
      }
    }
  }

  return symbols;
}

/**
 * 创建 list_symbols 工具
 * 列出文件中的符号（函数、类、常量等）
 */
export function createListSymbolsTool(projectDir: string): Tool {
  return {
    name: 'list_symbols',
    description:
      '列出文件中的符号（函数、类、接口、常量等）。适合快速了解文件结构。',
    parameters: z.object({
      path: z.string().describe('文件路径，相对于项目根目录'),
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
        const symbols = extractSymbols(content);
        const totalLines = content.split('\n').length;

        console.log(`[fs:list_symbols] Found ${symbols.length} symbols in ${args.path}`);

        return JSON.stringify({
          success: true,
          path: args.path,
          totalLines,
          symbolCount: symbols.length,
          symbols,
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

