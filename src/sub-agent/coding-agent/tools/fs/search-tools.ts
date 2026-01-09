/**
 * 搜索和代码分析工具
 * grep_files, read_file_lines, list_symbols
 */

import { z } from 'zod';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import type { Tool } from '../../../../types/index';

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
 * 代码符号接口
 */
interface CodeSymbol {
  name: string;
  type: 'function' | 'class' | 'const' | 'let' | 'var' | 'interface' | 'type' | 'export';
  line: number;
  signature: string;
}

/**
 * 简单的符号提取（基于正则）
 */
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
