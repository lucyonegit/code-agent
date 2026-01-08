/**
 * SSE (Server-Sent Events) 工具函数
 */

import http from 'http';

/**
 * 发送 SSE 事件
 */
export function sendSSE(res: http.ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * 设置 SSE 响应头
 */
export function setSSEHeaders(res: http.ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
}

/**
 * 设置 JSON 响应头
 */
export function setJSONHeaders(res: http.ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
}

/**
 * 发送 JSON 错误响应
 */
export function sendJSONError(res: http.ServerResponse, status: number, message: string): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify({ error: message }));
}

/**
 * 解析请求体
 */
export async function parseBody<T = any>(req: http.IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : ({} as T));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}
