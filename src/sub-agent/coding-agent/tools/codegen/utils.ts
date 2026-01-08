/**
 * 代码生成辅助工具函数
 */

import type { ArchitectureFile } from '../schemas';
import { searchComponentDocs, getComponentList } from '../rag';

/**
 * 拓扑排序：确保被依赖的文件先生成
 */
export function topologicalSort(files: ArchitectureFile[]): ArchitectureFile[] {
  const pathToFile = new Map<string, ArchitectureFile>();
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const file of files) {
    pathToFile.set(file.path, file);
    inDegree.set(file.path, 0);
    adjacency.set(file.path, []);
  }

  for (const file of files) {
    for (const dep of file.dependencies) {
      if (pathToFile.has(dep.path)) {
        adjacency.get(dep.path)?.push(file.path);
        inDegree.set(file.path, (inDegree.get(file.path) || 0) + 1);
      }
    }
  }

  const queue: string[] = [];
  for (const [path, degree] of inDegree) {
    if (degree === 0) queue.push(path);
  }

  const sorted: ArchitectureFile[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const file = pathToFile.get(current);
    if (file) sorted.push(file);

    for (const neighbor of adjacency.get(current) || []) {
      const newDegree = (inDegree.get(neighbor) || 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  const sortedPaths = new Set(sorted.map(f => f.path));
  for (const file of files) {
    if (!sortedPaths.has(file.path)) {
      sorted.push(file);
    }
  }

  return sorted;
}

/**
 * 获取 RAG 上下文
 */
export async function fetchRagContext(keywords: string[]): Promise<string> {
  let context = '';

  try {
    const componentResult = await getComponentList();
    const availableComponents: string[] = JSON.parse(componentResult.answer || '[]');

    const selected = availableComponents.filter(comp =>
      keywords.some(
        kw =>
          comp.toLowerCase().includes(kw.toLowerCase()) ||
          kw.toLowerCase().includes(comp.toLowerCase())
      )
    );

    for (const comp of selected.slice(0, 5)) {
      try {
        const result = await searchComponentDocs(
          '总结下这个组件的使用文档',
          comp,
          'API / Props',
          2
        );
        if (result?.answer) {
          context += `\n--- ${comp} ---\n${result.answer}\n`;
        }
      } catch {
        // ignore
      }
    }
  } catch {
    // RAG 不可用时继续
  }

  return context || 'No internal component documentation found.';
}

/**
 * 从 BDD 和架构中提取关键词
 */
export function extractKeywords(bddScenarios: string, architecture: ArchitectureFile[]): string[] {
  const keywords = new Set<string>();

  for (const file of architecture) {
    const basename =
      file.path
        .split('/')
        .pop()
        ?.replace(/\.(tsx?|css)$/, '') || '';
    if (basename) keywords.add(basename);
  }

  const commonComponents = ['Button', 'Input', 'Card', 'Modal', 'Table', 'Form', 'List', 'Icon'];
  const bddLower = bddScenarios.toLowerCase();
  for (const comp of commonComponents) {
    if (bddLower.includes(comp.toLowerCase())) {
      keywords.add(comp);
    }
  }

  return Array.from(keywords);
}
