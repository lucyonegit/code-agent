/**
 * ReActLogger - ReActExecutor 专用日志模块
 *
 * 特性：
 * - 5 个日志级别：SILENT / ERROR / WARN / INFO / DEBUG / TRACE
 * - 带时间戳的格式化输出
 * - 终端彩色输出
 * - Emoji 前缀增强可读性
 */

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
 * 提供分级日志输出功能
 */
export class ReActLogger {
  private level: LogLevel;
  private prefix: string;

  constructor(level: LogLevel = LogLevel.INFO, prefix = 'ReAct') {
    this.level = level;
    this.prefix = prefix;
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
    if (!this.shouldLog(level)) {
      return;
    }

    const config = LevelConfig[level];
    const timestamp = formatTimestamp();

    // 构建日志行
    // [时间戳] [级别] [前缀] emoji 消息
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
    if (!this.shouldLog(LogLevel.DEBUG)) {
      return;
    }
    const timestamp = formatTimestamp();
    console.log(
      `${Colors.gray}[${timestamp}]${Colors.reset} ${Colors.cyan}[${this.prefix}]${Colors.reset} ┌─ ${Colors.bold}${label}${Colors.reset}`
    );
  }

  /**
   * 分组结束 - 用于标记逻辑块的结束
   */
  groupEnd(label?: string): void {
    if (!this.shouldLog(LogLevel.DEBUG)) {
      return;
    }
    const timestamp = formatTimestamp();
    const endLabel = label ? ` ${label}` : '';
    console.log(
      `${Colors.gray}[${timestamp}]${Colors.reset} ${Colors.cyan}[${this.prefix}]${Colors.reset} └─${endLabel}`
    );
  }

  /**
   * 输出分隔线
   */
  separator(): void {
    if (!this.shouldLog(LogLevel.INFO)) {
      return;
    }
    console.log(`${Colors.gray}${'─'.repeat(60)}${Colors.reset}`);
  }

  /**
   * 直接输出流式内容（用于 TRACE 级别的 chunk 输出）
   * 不添加时间戳和前缀，直接写入标准输出
   */
  streamChunk(text: string): void {
    if (!this.shouldLog(LogLevel.TRACE)) {
      return;
    }
    process.stdout.write(text);
  }
}

/**
 * 从字符串解析日志级别
 */
export function parseLogLevel(levelStr: string): LogLevel {
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
