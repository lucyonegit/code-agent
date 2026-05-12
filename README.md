# ReAct Core

一个完全业务解耦的 ReAct Agent 核心框架。提供可编排的推理执行引擎、多层级规划能力、专业化子智能体（Coding Agent），以及基于 NestJS 的 HTTP/SSE 服务层。

---

## 核心特性

- **双模式推理引擎**
  - **ReAct 模式**：单轮循环推理（思考 → 工具调用 → 观察），支持流式输出
  - **Planner 模式**：外层生成结构化计划，内层用 ReAct 逐步骤执行，支持计划动态修正

- **Coding Agent（编码智能体）**
  - 意图分类：自动识别「简单查询」与「代码生成」任务
  - 需求澄清：人机协同，通过 `AgentPauseController` 在关键节点暂停并追问
  - 固定工作流：BDD 场景拆解 → 架构设计 → 代码生成
  - 增量工作流：基于已有 `projectId` 做增量修改
  - 配套文件系统工具：读/写/修改/搜索/删文件，支持符号级代码浏览

- **工具系统（ToolRegistry）**
  - 动态注册与 LangChain `StructuredTool` 自动转换
  - 内置工具：百度搜索、网页浏览、计算器、天气查询、组件文档 RAG、文章写作

- **对话持久化**
  - 文件型 JSON 存储，无需数据库
  - ReAct 会话：`react_conversation/{id}/conversation.json`
  - Planner 会话：`plan_conversation/{id}/conversation.json` + 计划快照

- **可观测性**
  - Langfuse 全链路追踪（Trace / Span / Generation），异常时自动降级
  - 分级日志（SILENT → TRACE），输出到 `logs/react_session.txt`

- **多模型支持**
  - 统一 `createLLM()` 工厂，支持 OpenAI、Claude、Gemini、通义千问、以及任意 OpenAI-Compatible 端点

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 运行时 | Node.js 20+ / TypeScript 5.3+ |
| Agent 框架 | LangChain / LangGraph |
| HTTP 服务 | NestJS 11 + Express |
| 流式通信 | Server-Sent Events (SSE) |
| 浏览器自动化 | Playwright |
| 可观测性 | Langfuse |
| 校验/类型 | Zod |
| 代码质量 | ESLint 9 + Prettier |

---

## 项目架构

```
┌──────────────────────────────────────────────────────────────┐
│                     HTTP API Layer                            │
│  (NestJS Controllers: React, Planner, Coding, Projects)      │
│                     SSE Streaming Output                      │
└──────────────────────────────────────────────────────────────┘
                               │
┌──────────────────────────────────────────────────────────────┐
│                      Service Layer                            │
│  (ReactService, PlannerService, CodingService, ToolsService) │
└──────────────────────────────────────────────────────────────┘
                               │
         ┌─────────────────────┼─────────────────────┐
         ▼                     ▼                     ▼
 ┌───────────────┐    ┌───────────────┐    ┌─────────────────┐
 │  ReActExecutor │    │PlannerExecutor│    │   CodingAgent   │
 │  (core/react/) │    │ (core/planner)│    │(sub-agent/coding)│
 └───────────────┘    └───────────────┘    └─────────────────┘
         │                     │                     │
         └─────────────────────┼─────────────────────┘
                               ▼
               ┌───────────────────────────────┐
               │      Core Infrastructure       │
               │  ToolRegistry, BaseLLM,        │
               │  ConversationManager,          │
               │  AgentPauseController,         │
               │  Langfuse, ReActLogger         │
               └───────────────────────────────┘
                               │
                               ▼
               ┌───────────────────────────────┐
               │    LLM Providers               │
               │  (OpenAI / Claude / Gemini     │
               │   / Tongyi / OpenAI-Compatible)│
               └───────────────────────────────┘
```

### 分层说明

| 目录 | 职责 | 设计原则 |
|------|------|----------|
| `src/core/` | 推理引擎与基础设施 | **业务零耦合**：只关心「推理循环、工具调用、上下文管理」，不知道「coding」「planning」等业务语义 |
| `src/server/` | NestJS HTTP 接入层 | 将 core 能力封装为 REST/SSE API，串联 Tools、React、Planner、Coding、Projects 模块 |
| `src/sub-agent/` | 专业化子智能体 | 当前只有 `coding-agent/`，内部有独立的工作流、工具集、服务层 |
| `src/types/` | 全局类型定义 | 跨层共享的接口、Event 联合类型、Zod Schema |
| `src/common/` | 公共类型复用 | 对 `types/` 的再导出与 LLM 相关补充类型 |

---

## 目录结构

```
agent/
├── src/
│   ├── index.ts                    # 库入口：导出 ReActExecutor、PlannerExecutor、ToolRegistry、类型
│   ├── types/
│   │   ├── index.ts                # 核心类型：Tool、ReActEvent、ReActConfig、Plan、PlannerConfig 等
│   │   └── unified-message.ts      # 跨会话历史兼容的消息格式
│   ├── common/
│   │   └── types/                  # 公共类型再导出
│   ├── core/
│   │   ├── react/                  # ReAct 推理引擎
│   │   │   ├── executor.ts         # ReActExecutor：主推理循环（流式/非流式、上下文截断、错误恢复）
│   │   │   ├── stream-handler.ts   # StreamHandler：处理 LLM 流式块，emit thought / final_answer_stream
│   │   │   ├── tool-handler.ts     # ToolHandler：并行执行工具调用、结果压缩、FinalAnswer 处理
│   │   │   ├── context-manager.ts  # ContextManager：Token 预算管理、消息截断
│   │   │   ├── constants.ts        # 默认 Prompt、最大迭代次数（10）、上下文上限（100k）
│   │   │   └── utils.ts            # 工具描述格式化（带缓存）
│   │   ├── planner/                # Planner 双循环引擎
│   │   │   ├── executor.ts         # PlannerExecutor：结构化计划生成 → 逐步 ReAct 执行 → 计划修正
│   │   │   ├── prompts.ts          # Planner / Refine / Summary 默认 Prompt
│   │   │   ├── schema.ts           # PlanRefinementSchema（Zod）
│   │   │   └── helpers.ts          # 计划状态辅助函数（是否完成、下一步、历史格式化）
│   │   ├── conversation/           # 文件型对话持久化
│   │   │   ├── react-conversation-manager.ts
│   │   │   ├── planner-conversation-manager.ts
│   │   │   ├── event-serializer.ts # ReActEvent ↔ ConversationEvent 转换
│   │   │   ├── conversation-event.ts
│   │   │   └── types.ts
│   │   ├── ToolRegistry.ts         # 工具注册表，自动转 LangChain StructuredTool
│   │   ├── BaseLLM.ts              # createLLM() 工厂：多提供商统一创建
│   │   ├── ReActLogger.ts          # 分级日志（SILENT → TRACE）
│   │   ├── langfuse.ts             # Langfuse 追踪集成
│   │   └── agent-pause.ts          # AgentPauseController：通用暂停/恢复机制
│   ├── server/                     # NestJS HTTP 服务
│   │   ├── main.ts                 # 启动入口（port 3002，CORS，全局异常过滤器）
│   │   ├── app.module.ts           # 根模块，聚合所有子模块
│   │   ├── common/
│   │   │   ├── common.module.ts
│   │   │   ├── filters/http-exception.filter.ts
│   │   │   └── agent-pause.controller.ts
│   │   ├── health/                 # GET /health
│   │   ├── tools/                  # GET /api/tools（列出可用工具）
│   │   ├── react/                  # POST /api/react（SSE 流式 ReAct）
│   │   ├── planner/                # POST /api/planner（SSE 流式 Planner）
│   │   ├── coding/                 # POST /api/coding（SSE 流式 Coding Agent）
│   │   └── projects/               # GET/POST/DELETE /api/projects/*（项目 CRUD）
│   └── sub-agent/
│       └── coding-agent/           # 编码智能体
│           ├── coding-agent.ts     # CodingAgent 主类：意图分类 → 工作流编排
│           ├── services/
│           │   ├── intent-classifier.ts
│           │   ├── requirement-clarifier.ts
│           │   ├── project-manager.ts
│           │   ├── template-generator.ts
│           │   ├── conversation-manager.ts
│           │   └── styles/         # UI 风格定义
│           ├── workflows/
│           │   ├── fixed-workflow.ts      # BDD → Architect → CodeGen
│           │   └── incremental-workflow.ts # 基于 projectId 增量修改
│           ├── tools/
│           │   ├── bdd.ts
│           │   ├── architect.ts
│           │   ├── codegen/        # fsCodeGenTool / incrementalCodeGenTool
│           │   ├── fs/             # 文件系统工具集
│           │   ├── rag.ts          # 组件文档 RAG
│           │   └── schemas.ts      # 共享 Zod Schema
│           └── types/index.ts      # CodingAgent 专属类型
├── projects/                       # Coding Agent 生成的项目存储目录
├── react_conversation/             # ReAct 会话持久化数据
├── plan_conversation/              # Planner 会话持久化数据
├── logs/                           # 运行时日志
├── dist/                           # TypeScript 编译输出
├── package.json
├── tsconfig.json
├── eslint.config.js
├── .prettierrc / .prettierignore
├── docker-compose.yml              # Langfuse 可观测性栈（Langfuse + Postgres + ClickHouse + Redis + MinIO）
└── .env                            # 环境变量（API Keys、Langfuse 配置等）
```

---

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 环境变量配置

在项目根目录创建 `.env` 文件（参考以下常用变量）：

```env
# LLM API
OPENAI_API_KEY=sk-xxx
OPENAI_BASE_URL=https://api.openai.com/v1

# 或通义千问
TONGYI_API_KEY=sk-xxx

# Langfuse 可观测性（可选）
LANGFUSE_PUBLIC_KEY=pk-xxx
LANGFUSE_SECRET_KEY=sk-xxx
LANGFUSE_HOST=http://localhost:3000
```

### 3. 编译

```bash
npm run build
```

### 4. 启动服务

```bash
# 生产模式
npm run serve

# 开发模式（热重载）
npm run serve:dev
```

服务默认监听 **3002** 端口。

### 5. 启动 Langfuse（可选）

```bash
docker compose up -d
```

---

## 核心模块详解

### ReAct Executor

单轮推理循环：

```
LLM 思考 → 决定调用工具 → 执行工具 → 观察结果 → （循环直到 FinalAnswer 或达到最大迭代数）
```

- **流式支持**：通过 `StreamHandler` 实时 emit `thought`、`final_answer_stream`
- **上下文管理**：`ContextManager` 根据 Token 预算自动截断历史消息
- **错误恢复**：单步工具执行失败不会中断整体循环，会携带错误信息继续推理
- **安全边界**：默认最大 10 次迭代，可配置

### Planner Executor

双循环架构：

1. **外层（计划生成）**：通过结构化 Tool Calling 生成带状态的多步骤 `Plan`
2. **内层（步骤执行）**：每个步骤委托给 `ReActExecutor`
3. **计划修正**：根据步骤执行结果，Planner 可动态调整后续计划

适合需要「先规划、后执行」的复杂任务场景。

### Coding Agent

专门面向软件开发的子智能体：

| 阶段 | 说明 |
|------|------|
| 意图分类 | 判断用户是「简单提问」还是「需要生成代码」 |
| 需求澄清 | 若信息不足，通过 `AgentPauseController` 暂停并生成追问 |
| BDD 拆解 | 将需求转化为行为驱动开发场景（Given/When/Then） |
| 架构设计 | 根据 BDD 输出文件结构、模块依赖、接口定义 |
| 代码生成 | 按架构逐文件生成代码，写入 `projects/{id}/` |

---

## API 端点

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| GET | `/api/tools` | 获取所有可用工具列表 |
| POST | `/api/react` | 执行 ReAct 推理（SSE 流式返回） |
| POST | `/api/planner` | 执行 Planner 推理（SSE 流式返回） |
| POST | `/api/coding` | 执行 Coding Agent（SSE 流式返回） |
| GET | `/api/projects` | 列出所有项目 |
| POST | `/api/projects` | 创建/保存项目 |
| DELETE | `/api/projects/:id` | 删除项目 |

> 所有执行类端点均使用 **Server-Sent Events (SSE)** 返回实时事件流，事件类型包括：`thought`、`tool_call`、`tool_call_result`、`final_result`、`phase_start`、`phase_complete`、`agent_pause`、`agent_resume` 等。

---

## 配置说明

### tsconfig.json 关键项

| 配置 | 值 | 说明 |
|------|-----|------|
| `target` | `ES2020` | 编译目标 |
| `module` | `ESNext` | ESM 模块 |
| `moduleResolution` | `bundler` | 适配现代打包器 |
| `strict` | `true` | 严格类型检查 |
| `experimentalDecorators` | `true` | NestJS 装饰器支持 |
| `declaration` | `true` | 生成 `.d.ts` 声明文件 |

### package.json 常用脚本

| 脚本 | 命令 | 说明 |
|------|------|------|
| `build` | `tsc` | 编译 TypeScript 到 `dist/` |
| `serve` | `npx tsx src/server/main.ts` | 启动 NestJS 服务 |
| `serve:dev` | `npx tsx --watch src/server/main.ts` | 开发热重载 |
| `typecheck` | `tsc --noEmit` | 仅类型检查 |
| `lint` | `eslint src --ext .ts,.tsx` | 代码检查 |
| `lint:fix` | `eslint src --ext .ts,.tsx --fix` | 自动修复 |
| `format` | `prettier --write "src/**/*.{ts,tsx,js,json}"` | 格式化代码 |

---

## 作为库使用

除了启动 HTTP 服务，你也可以直接导入核心类使用：

```typescript
import { ReActExecutor, PlannerExecutor, ToolRegistry } from 'react-core';

const registry = new ToolRegistry();
registry.register({
  name: 'calculator',
  description: '执行数学计算',
  parameters: z.object({ expression: z.string() }),
  execute: async ({ expression }) => eval(expression).toString(),
});

const executor = new ReActExecutor({
  model: 'gpt-4',
  tools: registry.getAllTools(),
  maxIterations: 10,
});

for await (const event of executor.execute({ query: '计算 123 * 456' })) {
  console.log(event);
}
```

---

## 设计原则

1. **业务解耦**：`core/` 层零业务逻辑，所有业务语义（coding、planning）封装在 `server/` 和 `sub-agent/`
2. **暂停/恢复**：`AgentPauseController` 提供通用的人机协同机制，core 层不感知暂停原因
3. **程序化工具链**：Coding Agent 在代码层面串联工具输出（BDD → Architect → CodeGen），不依赖 LLM 参数传递
4. **文件型持久化**：零数据库依赖，会话与项目均以 JSON 文件存储
5. **事件驱动流式**：所有执行器通过统一事件体系向外部暴露进度，天然适配 SSE
