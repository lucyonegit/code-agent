/**
 * 设计系统样式定义
 */

/**
 * 增强的 index.css - 带完整设计系统
 */
export const ENHANCED_INDEX_CSS = `:root {
  /* 颜色系统 */
  --color-bg: #0f0f23;
  --color-surface: #1a1a2e;
  --color-surface-hover: #252542;
  --color-primary: #6366f1;
  --color-primary-hover: #818cf8;
  --color-secondary: #22d3ee;
  --color-accent: #f472b6;
  --color-success: #10b981;
  --color-warning: #f59e0b;
  --color-error: #ef4444;
  --color-text: #f8fafc;
  --color-text-secondary: #94a3b8;
  --color-text-muted: #64748b;
  --color-border: #334155;
  
  /* 间距 */
  --space-xs: 0.25rem;
  --space-sm: 0.5rem;
  --space-md: 1rem;
  --space-lg: 1.5rem;
  --space-xl: 2rem;
  --space-2xl: 3rem;
  
  /* 圆角 */
  --radius-sm: 0.375rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;
  --radius-xl: 1rem;
  --radius-full: 9999px;
  
  /* 阴影 */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.4);
  --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.5);
  --shadow-glow: 0 0 20px rgba(99, 102, 241, 0.3);
  
  /* 过渡 */
  --transition-fast: 150ms ease-out;
  --transition-normal: 250ms ease-out;
  
  /* 字体 */
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  line-height: 1.6;
  font-weight: 400;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  min-height: 100vh;
  background: var(--color-bg);
  color: var(--color-text);
}

a {
  color: var(--color-primary);
  text-decoration: none;
  transition: color var(--transition-fast);
}

a:hover {
  color: var(--color-primary-hover);
}

button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-lg);
  border: none;
  border-radius: var(--radius-md);
  background: linear-gradient(135deg, var(--color-primary), var(--color-primary-hover));
  color: white;
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition-fast);
  box-shadow: var(--shadow-md);
}

button:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-lg), var(--shadow-glow);
}

button:active {
  transform: translateY(0);
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

input, textarea, select {
  padding: var(--space-sm) var(--space-md);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text);
  font-size: 1rem;
  transition: all var(--transition-fast);
}

input:focus, textarea:focus, select:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2);
}

input::placeholder {
  color: var(--color-text-muted);
}
`;

/**
 * 增强的 App.css
 */
export const ENHANCED_APP_CSS = `#root {
  max-width: 1280px;
  margin: 0 auto;
  padding: var(--space-2xl);
  min-height: 100vh;
}

.app {
  display: flex;
  flex-direction: column;
  gap: var(--space-xl);
}

/* 卡片样式 */
.card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: var(--space-lg);
  box-shadow: var(--shadow-md);
  transition: all var(--transition-normal);
}

.card:hover {
  border-color: var(--color-primary);
  box-shadow: var(--shadow-lg);
}

/* 标题样式 */
h1, h2, h3, h4, h5, h6 {
  color: var(--color-text);
  font-weight: 600;
  line-height: 1.3;
  letter-spacing: -0.02em;
}

h1 {
  font-size: 2.5rem;
  background: linear-gradient(135deg, var(--color-text), var(--color-primary));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

h2 {
  font-size: 1.875rem;
}

h3 {
  font-size: 1.5rem;
}

h4 {
  font-size: 1.25rem;
}

/* 文本样式 */
p {
  color: var(--color-text-secondary);
  line-height: 1.7;
}

.text-muted {
  color: var(--color-text-muted);
}

/* 布局工具 */
.flex {
  display: flex;
}

.flex-col {
  flex-direction: column;
}

.items-center {
  align-items: center;
}

.justify-center {
  justify-content: center;
}

.justify-between {
  justify-content: space-between;
}

.gap-sm {
  gap: var(--space-sm);
}

.gap-md {
  gap: var(--space-md);
}

.gap-lg {
  gap: var(--space-lg);
}

/* 响应式 */
@media (max-width: 768px) {
  #root {
    padding: var(--space-lg);
  }
  
  h1 {
    font-size: 2rem;
  }
}
`;
