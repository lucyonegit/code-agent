# Code Agent

A TypeScript ReAct agent core built around LangChain tool calling, with optional Planner, NestJS, and coding-agent adapters.

The repository explores how to keep the agent loop reusable while moving transport, business APIs, conversation persistence, and coding workflows into replaceable layers.

## Core capabilities

- ReAct execution with configurable iteration limits and model providers.
- LangChain message and structured-tool integration.
- Streaming events for thoughts, tool calls, tool results, and final answers.
- Zod-based tool schemas and a central `ToolRegistry`.
- Context truncation and tool-result length controls.
- Optional Planner execution for multi-step tasks.
- NestJS HTTP/SSE adapters for ReAct, Planner, coding, tool, and health endpoints.
- Experimental coding-agent workflows with filesystem and code-generation tools.

## Architecture

```text
Application / NestJS API
          │
          ▼
 Conversation managers
          │
          ├── ReActExecutor
          ├── PlannerExecutor
          └── Coding agent workflows
                    │
                    ▼
       LangChain models + tools
```

The package entry point exports `ReActExecutor`, `PlannerExecutor`, `ToolRegistry`, LangChain tool adapters, public event types, and validation schemas.

## Minimal usage

```ts
import { z } from "zod";
import { ReActExecutor, type Tool } from "./src/index.js";

const tools: Tool[] = [
  {
    name: "get_time",
    description: "Return the current ISO timestamp",
    parameters: z.object({}),
    execute: async () => new Date().toISOString(),
  },
];

const agent = new ReActExecutor({
  model: "your-model",
  provider: "openai",
  apiKey: process.env.MODEL_API_KEY,
  baseUrl: process.env.MODEL_BASE_URL,
  streaming: true,
});

const answer = await agent.run({
  input: "What time is it?",
  tools,
  onMessage: async (event) => console.log(event),
});

console.log(answer);
```

## Development

```bash
npm install
npm run typecheck
npm run build
```

To run the NestJS adapter:

```bash
npm run serve:dev
```

Model credentials can be passed directly to the executor. The current default adapter also supports `LITE_LLM_APIKEY` as a fallback.

## Status

This is an experimental agent SDK and server prototype. It predates the more durable persistence and recovery work in [`agent-runtime-v2`](https://github.com/lucyonegit/agent-runtime-v2), but remains useful as a compact reference for reusable ReAct, tool, and transport boundaries.
