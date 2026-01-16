/**
 * 模版生成服务
 * 使用 Vite 脚手架动态生成 React + TypeScript 项目模版
 */

import { execSync } from 'child_process';
import { readFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type {
  WebContainerTree,
  WebContainerFile,
  WebContainerDirectory,
} from '../../types';
import { ENHANCED_INDEX_CSS, ENHANCED_APP_CSS } from './styles';

export interface TemplateConfig {
  framework: 'react-ts' | 'react' | 'vue-ts' | 'vue';
  cacheTTL?: number; // 缓存有效期（毫秒），默认 24 小时
}

interface CacheEntry {
  template: WebContainerTree;
  createdAt: number;
}

// 内存缓存
const templateCache = new Map<string, CacheEntry>();

// 默认缓存有效期：24 小时
const DEFAULT_CACHE_TTL = 24 * 60 * 60 * 1000;

/**
 * 获取或生成 Vite 模版
 */
export async function getViteTemplate(
  config: TemplateConfig = { framework: 'react-ts' }
): Promise<WebContainerTree> {
  const cacheKey = config.framework;
  const cacheTTL = config.cacheTTL ?? DEFAULT_CACHE_TTL;

  // 检查缓存
  const cached = templateCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < cacheTTL) {
    console.log(`[TemplateGenerator] Using cached template for ${cacheKey}`);
    return cached.template;
  }

  // 生成新模版
  console.log(`[TemplateGenerator] Generating new template for ${cacheKey}...`);
  const template = await generateViteTemplate(config);

  // 缓存结果
  templateCache.set(cacheKey, {
    template,
    createdAt: Date.now(),
  });

  return template;
}

/**
 * 使用 Vite 脚手架生成模版
 */
async function generateViteTemplate(config: TemplateConfig): Promise<WebContainerTree> {
  const tempDir = join(tmpdir(), `vite-template-${Date.now()}`);

  try {
    // 确保临时目录存在
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }

    // 使用 create-vite 生成项目
    const command = `npm create vite@latest . -- --template ${config.framework}`;
    console.log(`[TemplateGenerator] Executing: ${command} in ${tempDir}`);

    execSync(command, {
      cwd: tempDir,
      stdio: 'pipe',
      timeout: 60000, // 60 秒超时
    });

    // 读取生成的文件并转换为 WebContainerTree
    const tree = directoryToTree(tempDir);

    // 注入增强的设计系统样式
    injectDesignSystem(tree);

    return tree;
  } catch (error) {
    console.error('[TemplateGenerator] Failed to generate template:', error);
    // 返回内置的备用模版
    return getFallbackTemplate();
  } finally {
    // 清理临时目录
    try {
      execSync(`rm -rf "${tempDir}"`, { stdio: 'pipe' });
    } catch {
      // 忽略清理失败
    }
  }
}

/**
 * 递归读取目录并转换为 WebContainerTree
 */
function directoryToTree(dirPath: string): WebContainerTree {
  const tree: WebContainerTree = {};
  const entries = readdirSync(dirPath);

  for (const entry of entries) {
    // 跳过 node_modules 和 .git
    if (entry === 'node_modules' || entry === '.git') {
      continue;
    }

    const fullPath = join(dirPath, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      tree[entry] = {
        directory: directoryToTree(fullPath),
      } as WebContainerDirectory;
    } else if (stat.isFile()) {
      try {
        const content = readFileSync(fullPath, 'utf-8');
        tree[entry] = {
          file: {
            contents: content,
          },
        } as WebContainerFile;
      } catch {
        // 跳过无法读取的文件
      }
    }
  }

  return tree;
}

/**
 * 注入增强的设计系统样式到模版
 */
function injectDesignSystem(tree: WebContainerTree): void {
  // 查找 src 目录
  const srcDir = tree['src'] as WebContainerDirectory | undefined;
  if (!srcDir?.directory) return;

  // 查找并增强 index.css
  const indexCss = srcDir.directory['index.css'] as WebContainerFile | undefined;
  if (indexCss?.file) {
    indexCss.file.contents = ENHANCED_INDEX_CSS;
  }

  // 查找并增强 App.css
  const appCss = srcDir.directory['App.css'] as WebContainerFile | undefined;
  if (appCss?.file) {
    appCss.file.contents = ENHANCED_APP_CSS;
  }
}

/**
 * 备用内置模版（当脚手架失败时使用）
 */
function getFallbackTemplate(): WebContainerTree {
  return {
    'package.json': {
      file: {
        contents: JSON.stringify(
          {
            name: 'vite-react-ts',
            private: true,
            version: '0.0.0',
            type: 'module',
            scripts: {
              dev: 'vite',
              build: 'tsc -b && vite build',
              preview: 'vite preview',
            },
            dependencies: {
              react: '^18.2.0',
              'react-dom': '^18.2.0',
            },
            devDependencies: {
              '@types/react': '^18.2.66',
              '@types/react-dom': '^18.2.22',
              '@vitejs/plugin-react': '^4.2.1',
              typescript: '^5.2.2',
              vite: '^5.2.0',
            },
          },
          null,
          2
        ),
      },
    },
    'vite.config.ts': {
      file: {
        contents: `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
})
`,
      },
    },
    'tsconfig.json': {
      file: {
        contents: JSON.stringify(
          {
            compilerOptions: {
              target: 'ES2022',
              useDefineForClassFields: true,
              lib: ['ES2022', 'DOM', 'DOM.Iterable'],
              module: 'ESNext',
              skipLibCheck: true,
              moduleResolution: 'bundler',
              allowImportingTsExtensions: true,
              noEmit: true,
              jsx: 'react-jsx',
              strict: true,
            },
            include: ['src'],
          },
          null,
          2
        ),
      },
    },
    'index.html': {
      file: {
        contents: `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Vite + React + TS</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
      },
    },
    src: {
      directory: {
        'main.tsx': {
          file: {
            contents: `import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
`,
          },
        },
        'App.tsx': {
          file: {
            contents: `import './App.css'

function App() {
  return (
    <div className="app">
      {/* AI generated content will be injected here */}
    </div>
  )
}

export default App
`,
          },
        },
        'index.css': {
          file: {
            contents: ENHANCED_INDEX_CSS,
          },
        },
        'App.css': {
          file: {
            contents: ENHANCED_APP_CSS,
          },
        },
      },
    },
  };
}

/**
 * 清除模版缓存
 */
export function clearTemplateCache(framework?: string): void {
  if (framework) {
    templateCache.delete(framework);
  } else {
    templateCache.clear();
  }
}

// 重新导出项目管理功能
export {
  initializeProjectDirectory,
  readProjectTree,
  persistProject,
  listProjects,
  getProjectTree,
  getProjectInfo,
  cleanupTempDirectory,
  deleteProject,
  getTempProjectPath,
  getProjectPath,
  type ProjectInfo,
} from './project-manager';
