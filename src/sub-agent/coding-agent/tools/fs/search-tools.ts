/**
 * 搜索和代码分析工具
 * grep_files, read_file_lines, list_symbols
 */

import { z } from 'zod';
import { existsSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import { execSync } from 'child_process';
import type { Tool } from '../../../../types/index';

/**
 * 转义 Shell 参数，防止命令注入
 * 使用单引号包裹，并转义内部的单引号
 */
function escapeShellArg(arg: string): string {
  // 将单引号替换为 '\''（结束引号、转义单引号、开始新引号）
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * 使用系统 grep 命令搜索文件内容
 * 性能远优于 Node.js 递归实现
 */
function grepSearch(
  searchDir: string,
  pattern: string,
  includes: string[],
  maxResults: number
): { path: string; line: number; content: string }[] {
  const results: { path: string; line: number; content: string }[] = [];

  try {
    // 构建 grep 命令参数
    const args: string[] = [
      '-r', // 递归搜索
      '-n', // 显示行号
      '-E', // 使用扩展正则表达式
      '-i', // 忽略大小写
      '-I', // 忽略二进制文件
      '--exclude-dir=node_modules', // 排除 node_modules
      '--exclude-dir=.git', // 排除 .git
      '--exclude-dir=.next', // 排除 .next
      '--exclude-dir=dist', // 排除 dist
      '--exclude-dir=build', // 排除 build
    ];

    // 添加文件类型过滤（使用 Shell 转义防注入）
    if (includes.length > 0) {
      for (const inc of includes) {
        args.push(`--include=${escapeShellArg(inc)}`);
      }
    }

    // 构建完整命令（使用 Shell 转义保护 pattern）
    const cmd = `grep ${args.join(' ')} -e ${escapeShellArg(pattern)} . 2>/dev/null | head -n ${maxResults}`;

    // 执行 grep 命令
    const output = execSync(cmd, {
      cwd: searchDir,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
    });

    // 解析 grep 输出
    // 格式: ./path/to/file:lineNumber:matchedContent
    // 从右往左解析，正确处理文件名中包含冒号的情况
    const lines = output.trim().split('\n').filter(Boolean);

    for (const line of lines) {
      // 移除开头的 ./
      const withoutPrefix = line.startsWith('./') ? line.slice(2) : line;

      // 从右往左查找，找到最后一个冒号（分隔行号和内容）
      const lastColonIndex = withoutPrefix.lastIndexOf(':');
      if (lastColonIndex === -1) continue;

      const beforeLastColon = withoutPrefix.slice(0, lastColonIndex);
      const content = withoutPrefix.slice(lastColonIndex + 1);

      // 再找倒数第二个冒号（分隔文件路径和行号）
      const secondLastColonIndex = beforeLastColon.lastIndexOf(':');
      if (secondLastColonIndex === -1) continue;

      const path = beforeLastColon.slice(0, secondLastColonIndex);
      const lineNumStr = beforeLastColon.slice(secondLastColonIndex + 1);
      const lineNum = parseInt(lineNumStr, 10);

      if (isNaN(lineNum)) continue;

      results.push({
        path,
        line: lineNum,
        content: content.trim().slice(0, 200), // 截断过长的行
      });
    }
  } catch (error) {
    // grep 没有匹配时会返回 exit code 1，这不是错误
    if (error instanceof Error && 'status' in error && (error as { status: number }).status === 1) {
      // 没有匹配结果，返回空数组
      return results;
    }
    // 其他错误则抛出
    throw error;
  }

  return results;
}

/**
 * 创建 grep_files 工具
 * 在项目中搜索匹配的代码行
 */
export function createGrepFilesTool(projectDir: string): Tool {
  return {
    name: 'grep_files',
    description:
      '在项目中搜索匹配的代码行。支持扩展正则表达式（POSIX ERE）。返回匹配行的文件路径、行号和内容。适合快速定位代码位置。注意：仅适用于 Unix/Linux/Mac 系统。',
    parameters: z.object({
      pattern: z.string().describe('搜索词或正则表达式（支持 POSIX 扩展正则，如 [0-9]+, (abc|def) 等）'),
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
        const results = grepSearch(searchDir, args.pattern, includes, maxResults);

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
