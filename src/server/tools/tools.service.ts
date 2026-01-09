/**
 * 工具注册服务
 */

import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { chromium, Browser, Page } from 'playwright';
import type { Tool } from '../../types';
import {
  createRagSearchTool,
  createGetComponentListTool,
} from '../../sub-agent/coding-agent/tools/rag';

/**
 * 浏览器实例管理 - 单例模式复用浏览器
 */
let browserInstance: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserInstance || !browserInstance.isConnected()) {
    browserInstance = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }
  return browserInstance;
}

/**
 * 从页面提取主要文本内容 - 使用 Playwright 高层 API
 */
async function extractPageContent(page: Page, maxLength: number = 5000): Promise<string> {
  // 尝试获取主要内容区域的文本
  const mainSelectors = ['main', 'article', '.content', '#content', '.main', '#main', 'body'];

  let content = '';
  for (const selector of mainSelectors) {
    const element = await page.$(selector);
    if (element) {
      content = await element.innerText().catch(() => '');
      if (content.trim()) break;
    }
  }

  // 清理文本：移除多余空白
  content = content
    .replace(/\s+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .trim();

  return content.slice(0, maxLength);
}

/**
 * 使用百度搜索（国内可访问）
 */
async function performWebSearch(query: string): Promise<Array<{ title: string; url: string; snippet: string }>> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'zh-CN',
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();

  try {
    page.setDefaultTimeout(20000);

    // 使用百度搜索
    const searchUrl = `https://www.baidu.com/s?wd=${encodeURIComponent(query)}`;
    console.log(`[web_search] 正在搜索: ${query}`);
    console.log(`[web_search] URL: ${searchUrl}`);

    await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });

    // 等待搜索结果加载
    await page.waitForSelector('#content_left', { timeout: 10000 }).catch(() => { });
    await page.waitForTimeout(1000);

    // 百度搜索结果选择器
    const resultElements = await page.$$('#content_left .result, #content_left .c-container');
    console.log(`[web_search] 找到 ${resultElements.length} 个结果元素`);

    const results: Array<{ title: string; url: string; snippet: string }> = [];

    for (let i = 0; i < Math.min(resultElements.length, 5); i++) {
      const el = resultElements[i];

      // 百度结构: h3 > a (标题和链接), .c-abstract 或 span (摘要)
      const titleEl = await el.$('h3 a, .t a');
      const snippetEl = await el.$('.c-abstract, .c-span-last, .content-right_8Zs40');

      if (titleEl) {
        const title = await titleEl.innerText().catch(() => '');
        const url = await titleEl.getAttribute('href') || '';
        const snippet = snippetEl ? await snippetEl.innerText().catch(() => '') : '';

        if (title.trim()) {
          results.push({
            title: title.trim(),
            url: url, // 百度的链接是跳转链接
            snippet: snippet.trim()
          });
        }
      }
    }

    console.log(`[web_search] 成功提取 ${results.length} 条结果`);
    return results;
  } catch (error) {
    console.error(`[web_search] 搜索出错:`, error);
    throw error;
  } finally {
    await page.close();
    await context.close();
  }
}

/**
 * 浏览指定 URL 并提取内容
 */
async function browseUrl(url: string): Promise<{ title: string; content: string; url: string }> {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    page.setDefaultTimeout(20000);

    await page.goto(url, { waitUntil: 'domcontentloaded' });

    // 等待页面内容加载
    await page.waitForTimeout(1000);

    const title = await page.title();
    const content = await extractPageContent(page);

    return {
      title,
      content,
      url: page.url(),
    };
  } finally {
    await page.close();
  }
}

/**
 * 预定义工具集合
 */
const AVAILABLE_TOOLS: Record<string, Tool> = {
  get_weather: {
    name: 'get_weather',
    description: '获取指定位置的当前天气信息',
    parameters: z.object({
      location: z.string().describe('要获取天气的城市或位置'),
      unit: z.enum(['celsius', 'fahrenheit']).nullable().optional().describe('温度单位'),
    }),
    execute: async args => {
      return JSON.stringify({
        location: args.location,
        temperature: 25,
        unit: args.unit || 'celsius',
        condition: '晴天',
        humidity: 60,
      });
    },
  },
  calculator: {
    name: 'calculator',
    description: '执行数学计算',
    parameters: z.object({
      expression: z.string().describe('数学表达式'),
    }),
    execute: async args => {
      try {
        const sanitized = args.expression.replace(/[^0-9+\-*/().%\s]/g, '');
        const result = Function(`"use strict"; return (${sanitized})`)();
        return `${args.expression} = ${result}`;
      } catch {
        return `计算错误: ${args.expression}`;
      }
    },
  },
  web_search: {
    name: 'web_search',
    description: '在互联网上搜索信息。返回相关网页的标题、链接和摘要。适用于查找最新信息、新闻、技术文档等。',
    parameters: z.object({
      query: z.string().describe('搜索关键词或问题'),
    }),
    execute: async args => {
      try {
        const results = await performWebSearch(args.query);
        if (results.length === 0) {
          return JSON.stringify({ error: '未找到相关结果', query: args.query });
        }
        return JSON.stringify({
          query: args.query,
          results_count: results.length,
          results,
        });
      } catch (error) {
        return JSON.stringify({
          error: `搜索失败: ${error instanceof Error ? error.message : String(error)}`,
          query: args.query,
        });
      }
    },
  },
  browse_url: {
    name: 'browse_url',
    description: '访问指定的网页URL并提取页面内容。可用于获取网页的详细信息、阅读文章、查看文档等。',
    parameters: z.object({
      url: z.string().url().describe('要访问的网页URL'),
    }),
    execute: async args => {
      try {
        const result = await browseUrl(args.url);
        return JSON.stringify({
          success: true,
          title: result.title,
          url: result.url,
          content: result.content,
        });
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: `访问失败: ${error instanceof Error ? error.message : String(error)}`,
          url: args.url,
        });
      }
    },
  },
  // RAG 工具
  search_component_docs: createRagSearchTool(),
  get_component_list: createGetComponentListTool(),
};

@Injectable()
export class ToolsService {
  /**
   * 获取所有可用工具的简要信息
   */
  getToolsList() {
    return Object.keys(AVAILABLE_TOOLS).map(name => ({
      name,
      description: AVAILABLE_TOOLS[name].description,
    }));
  }

  /**
   * 根据名称获取工具列表
   */
  getToolsByNames(names: string[]): Tool[] {
    return names
      .filter(name => AVAILABLE_TOOLS[name])
      .map(name => AVAILABLE_TOOLS[name]);
  }

  /**
   * 获取所有可用工具
   */
  getAllTools(): Record<string, Tool> {
    return AVAILABLE_TOOLS;
  }
}
