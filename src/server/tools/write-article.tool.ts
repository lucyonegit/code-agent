/**
 * Write Article Tool - 将内容写入 artifacts 目录
 */

import { z } from 'zod';
import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import type { Tool } from '../../types';

export function createWriteArticleTool(mode: 'react' | 'plan', conversationId: string): Tool {
  return {
    name: 'write_article',
    description: '将生成的文章、文档或长文本写入会话对应的 artifacts 目录。',
    parameters: z.object({
      title: z.string().describe('文章标题，将作为文件名的一部分'),
      content: z.string().describe('文章内容，支持 Markdown 格式'),
      format: z.enum(['markdown', 'text', 'html']).optional().default('markdown').describe('文件格式'),
    }),
    execute: async (args: any) => {
      const { title, content, format = 'markdown' } = args;

      // 确定根目录 (与 ReactConversationManager / PlannerConversationManager 保持一致)
      const baseDirName = mode === 'react' ? 'react_conversation' : 'plan_conversation';
      const artifactsDir = join(process.cwd(), baseDirName, conversationId, 'artifacts');

      // 确保目录存在
      if (!existsSync(artifactsDir)) {
        mkdirSync(artifactsDir, { recursive: true });
      }

      // 生成文件名（简单处理非法字符）
      const ext = format === 'markdown' ? '.md' : format === 'html' ? '.html' : '.txt';
      const safeTitle = title.replace(/[<>:"/\\|?*]/g, '_');
      const fileName = `${safeTitle}${ext}`;
      const filePath = join(artifactsDir, fileName);

      // 写入文件
      writeFileSync(filePath, content, 'utf-8');

      return `文件已成功写入到 artifacts 目录。\n文件名: ${fileName}\n完整路径: ${filePath}`;
    },
  };
}
