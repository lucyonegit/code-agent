/**
 * ReActLogger - ReActExecutor 专用日志模块
 *
 * 特性：
 * - 5 个日志级别：SILENT / ERROR / WARN / INFO / DEBUG / TRACE
 * - 带时间戳的格式化输出
 * - 终端彩色输出
 * - Emoji 前缀增强可读性
 * - 支持日志持久化到文件
 */

import { existsSync, mkdirSync, writeFileSync, appendFileSync } from 'fs';
import { dirname, extname, basename, join } from 'path';

/**
 * 日志级别枚举
 * 数值越大，输出越详细
 */
export enum LogLevel {
  SILENT = 0, // 完全静默
  ERROR = 1, // 仅错误
  WARN = 2, // 警告 + 错误
  INFO = 3, // 关键节点（默认）
  DEBUG = 4, // 全链路详细日志
  TRACE = 5, // 含流式 chunk 的完整追踪
}

/**
 * 终端颜色代码
 */
const Colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',

  // 前景色
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',

  // 背景色
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
} as const;

/**
 * 日志级别配置
 */
const LevelConfig: Record<
  Exclude<LogLevel, LogLevel.SILENT>,
  {
    label: string;
    color: string;
    emoji: string;
  }
> = {
  [LogLevel.ERROR]: {
    label: 'ERROR',
    color: Colors.red,
    emoji: '❌',
  },
  [LogLevel.WARN]: {
    label: 'WARN',
    color: Colors.yellow,
    emoji: '⚠️',
  },
  [LogLevel.INFO]: {
    label: 'INFO',
    color: Colors.green,
    emoji: '✓',
  },
  [LogLevel.DEBUG]: {
    label: 'DEBUG',
    color: Colors.blue,
    emoji: '🔍',
  },
  [LogLevel.TRACE]: {
    label: 'TRACE',
    color: Colors.gray,
    emoji: '📡',
  },
};

/**
 * 格式化时间戳
 */
function formatTimestamp(): string {
  const now = new Date();
  return now.toISOString().replace('T', ' ').replace('Z', '');
}

/**
 * 格式化数据对象为可读字符串
 */
function formatData(data: unknown, maxLength = 500): string {
  if (data === undefined || data === null) {
    return '';
  }

  let str: string;
  if (typeof data === 'string') {
    str = data;
  } else {
    try {
      str = JSON.stringify(data, null, 2);
    } catch {
      str = String(data);
    }
  }

  if (str.length > maxLength) {
    return str.slice(0, maxLength) + '...';
  }
  return str;
}

/**
 * ReActLogger 类
 * 提供分级日志输出功能，支持日志持久化
 */
export class ReActLogger {
  private level: LogLevel;
  private prefix: string;
  private logFilePath: string | null = null;
  private sessionId: string;

  constructor(level: LogLevel = LogLevel.INFO, prefix = 'ReAct', logFilePath?: string) {
    this.level = level;
    this.prefix = prefix;
    this.sessionId = this.generateSessionId();

    if (logFilePath) {
      this.initLogFile(logFilePath);
    }
  }

  /**
   * 生成会话 ID（用于日志文件名）
   */
  private generateSessionId(): string {
    const now = new Date();
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}_${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * 初始化日志文件
   */
  private initLogFile(basePath: string): void {
    // 确保目录存在
    const dir = dirname(basePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // 生成带会话 ID 的文件名
    const ext = extname(basePath) || '.txt';
    const base = basename(basePath, ext);
    const filename = `${base}_${this.sessionId}${ext}`;
    this.logFilePath = join(dir, filename);

    // 写入日志头
    const header = [
      `${'='.repeat(60)}`,
      `ReAct Session Log`,
      `Session ID: ${this.sessionId}`,
      `Started: ${new Date().toISOString()}`,
      `Log Level: TRACE (All levels recorded)`,
      `${'='.repeat(60)}`,
      '',
    ].join('\n');

    writeFileSync(this.logFilePath, header, 'utf-8');
    console.log(`[ReActLogger] Log file created: ${this.logFilePath}`);
  }

  /**
   * 写入日志到文件
   */
  private writeToFile(line: string): void {
    if (!this.logFilePath) return;
    appendFileSync(this.logFilePath, line + '\n', 'utf-8');
  }

  /**
   * 获取日志文件路径
   */
  getLogFilePath(): string | null {
    return this.logFilePath;
  }

  /**
   * 获取当前日志级别
   */
  getLevel(): LogLevel {
    return this.level;
  }

  /**
   * 设置日志级别
   */
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  /**
   * 检查是否应该输出指定级别的日志
   */
  private shouldLog(level: LogLevel): boolean {
    return this.level >= level;
  }

  /**
   * 格式化并输出日志
   */
  private log(level: Exclude<LogLevel, LogLevel.SILENT>, message: string, data?: unknown): void {
    const config = LevelConfig[level];
    const timestamp = formatTimestamp();

    // 构建纯文本日志行（用于文件）
    const plainLogLine = `[${timestamp}] [${config.label}] [${this.prefix}] ${config.emoji} ${message}`;

    // 始终写入文件（记录所有级别）
    if (this.logFilePath) {
      this.writeToFile(plainLogLine);
      if (data !== undefined && data !== null) {
        const formattedData = formatData(data, 2000); // 文件中记录更多内容
        if (formattedData) {
          const lines = formattedData.split('\n');
          for (const line of lines) {
            this.writeToFile(`    │ ${line}`);
          }
        }
      }
    }

    // 控制台输出（受日志级别控制）
    if (!this.shouldLog(level)) {
      return;
    }

    // 构建带颜色的日志行
    const timestampPart = `${Colors.gray}[${timestamp}]${Colors.reset}`;
    const levelPart = `${config.color}[${config.label}]${Colors.reset}`;
    const prefixPart = `${Colors.cyan}[${this.prefix}]${Colors.reset}`;
    const messagePart = `${config.emoji} ${message}`;

    console.log(`${timestampPart} ${levelPart} ${prefixPart} ${messagePart}`);

    // 如果有数据，缩进输出
    if (data !== undefined && data !== null) {
      const formattedData = formatData(data);
      if (formattedData) {
        const lines = formattedData.split('\n');
        for (const line of lines) {
          console.log(`${Colors.gray}    │ ${line}${Colors.reset}`);
        }
      }
    }
  }

  /**
   * TRACE 级别日志 - 最详细，包含流式 chunk
   */
  trace(message: string, data?: unknown): void {
    this.log(LogLevel.TRACE, message, data);
  }

  /**
   * DEBUG 级别日志 - 详细调试信息
   */
  debug(message: string, data?: unknown): void {
    this.log(LogLevel.DEBUG, message, data);
  }

  /**
   * INFO 级别日志 - 关键节点信息
   */
  info(message: string, data?: unknown): void {
    this.log(LogLevel.INFO, message, data);
  }

  /**
   * WARN 级别日志 - 警告信息
   */
  warn(message: string, data?: unknown): void {
    this.log(LogLevel.WARN, message, data);
  }

  /**
   * ERROR 级别日志 - 错误信息
   */
  error(message: string, data?: unknown): void {
    this.log(LogLevel.ERROR, message, data);
  }

  /**
   * 分组开始 - 用于标记逻辑块的开始
   */
  group(label: string): void {
    const timestamp = formatTimestamp();
    const plainLine = `[${timestamp}] [${this.prefix}] ┌─ ${label}`;

    // 始终写入文件
    this.writeToFile(plainLine);

    if (!this.shouldLog(LogLevel.DEBUG)) {
      return;
    }
    console.log(
      `${Colors.gray}[${timestamp}]${Colors.reset} ${Colors.cyan}[${this.prefix}]${Colors.reset} ┌─ ${Colors.bold}${label}${Colors.reset}`
    );
  }

  /**
   * 分组结束 - 用于标记逻辑块的结束
   */
  groupEnd(label?: string): void {
    const timestamp = formatTimestamp();
    const endLabel = label ? ` ${label}` : '';
    const plainLine = `[${timestamp}] [${this.prefix}] └─${endLabel}`;

    // 始终写入文件
    this.writeToFile(plainLine);

    if (!this.shouldLog(LogLevel.DEBUG)) {
      return;
    }
    console.log(
      `${Colors.gray}[${timestamp}]${Colors.reset} ${Colors.cyan}[${this.prefix}]${Colors.reset} └─${endLabel}`
    );
  }

  /**
   * 输出分隔线
   */
  separator(): void {
    const line = '─'.repeat(60);

    // 始终写入文件
    this.writeToFile(line);

    if (!this.shouldLog(LogLevel.INFO)) {
      return;
    }
    console.log(`${Colors.gray}${line}${Colors.reset}`);
  }

  /**
   * 直接输出流式内容（用于 TRACE 级别的 chunk 输出）
   * 不添加时间戳和前缀，直接写入标准输出
   */
  streamChunk(text: string): void {
    // 始终写入文件
    if (this.logFilePath) {
      appendFileSync(this.logFilePath, text, 'utf-8');
    }

    if (!this.shouldLog(LogLevel.TRACE)) {
      return;
    }
    process.stdout.write(text);
  }
}

/**
 * 从字符串解析日志级别
 */
function parseLogLevel(levelStr: string): LogLevel {
  const normalized = levelStr.toUpperCase();
  switch (normalized) {
    case 'SILENT':
      return LogLevel.SILENT;
    case 'ERROR':
      return LogLevel.ERROR;
    case 'WARN':
    case 'WARNING':
      return LogLevel.WARN;
    case 'INFO':
      return LogLevel.INFO;
    case 'DEBUG':
      return LogLevel.DEBUG;
    case 'TRACE':
      return LogLevel.TRACE;
    default:
      return LogLevel.INFO;
  }
}
