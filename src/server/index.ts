/**
 * SSE Server - 通过 Server-Sent Events 暴露 ReActExecutor 和 PlannerExecutor 接口
 *
 * 使用方法：
 * 1. 启动服务器: npx tsx src/server/index.ts
 * 2. 发送请求: POST /api/react 或 POST /api/planner
 *    Body: { "input": "你的问题", "tools": ["tool1", "tool2"] }
 * 3. 接收 SSE 流式响应
 */

import http from 'http';
// 请求处理器
import { handleReactRequest } from './handlers/react.js';
import { handlePlannerRequest } from './handlers/planner.js';
import { handleCodingRequest } from './handlers/coding.js';
import {
  handleListProjects,
  handleGetProject,
  handlePersistProject,
  handleDeleteProject,
} from './handlers/projects.js';

// 工具和工具函数
import { AVAILABLE_TOOLS } from './tools/index.js';

// ============================================================================
// 配置
// ============================================================================

const PORT = 3002;

// ============================================================================
// 服务器创建
// ============================================================================

const server = http.createServer(async (req, res) => {
  const { method, url } = req;

  // CORS 预检请求
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, DELETE',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  // 健康检查
  if (method === 'GET' && url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  // 获取可用工具列表
  if (method === 'GET' && url === '/api/tools') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(
      JSON.stringify({
        tools: Object.keys(AVAILABLE_TOOLS).map(name => ({
          name,
          description: AVAILABLE_TOOLS[name].description,
        })),
      })
    );
    return;
  }

  // ReAct 接口
  if (method === 'POST' && url === '/api/react') {
    await handleReactRequest(req, res);
    return;
  }

  // Planner 接口
  if (method === 'POST' && url === '/api/planner') {
    await handlePlannerRequest(req, res);
    return;
  }

  // Coding 接口
  if (method === 'POST' && url === '/api/coding') {
    await handleCodingRequest(req, res);
    return;
  }

  // ========== 项目管理 API ==========

  // 获取项目列表
  if (method === 'GET' && url === '/api/projects') {
    await handleListProjects(req, res);
    return;
  }

  // 项目详情 / 持久化 / 删除（带 ID 的路由）
  const projectMatch = url?.match(/^\/api\/projects\/([^/]+)(\/persist)?$/);
  if (projectMatch) {
    const projectId = projectMatch[1];
    const isPersist = projectMatch[2] === '/persist';

    if (method === 'GET' && !isPersist) {
      await handleGetProject(req, res, projectId);
      return;
    }

    if (method === 'POST' && isPersist) {
      await handlePersistProject(req, res, projectId);
      return;
    }

    if (method === 'DELETE' && !isPersist) {
      await handleDeleteProject(req, res, projectId);
      return;
    }
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
});

// 启动服务器
server.listen(PORT, () => {
  console.log(`🚀 Agent SSE Server running at http://localhost:${PORT}`);
  console.log('');
  console.log('可用接口:');
  console.log(`  GET  http://localhost:${PORT}/health           - 健康检查`);
  console.log(`  GET  http://localhost:${PORT}/api/tools        - 获取可用工具`);
  console.log(`  POST http://localhost:${PORT}/api/react        - ReAct 执行 (SSE)`);
  console.log(`  POST http://localhost:${PORT}/api/planner      - Planner 执行 (SSE)`);
  console.log(`  POST http://localhost:${PORT}/api/coding       - Coding 执行 (SSE)`);
  console.log('');
  console.log('项目管理接口:');
  console.log(`  GET    http://localhost:${PORT}/api/projects           - 获取项目列表`);
  console.log(`  GET    http://localhost:${PORT}/api/projects/:id       - 获取项目详情`);
  console.log(`  POST   http://localhost:${PORT}/api/projects/:id/persist - 持久化项目`);
  console.log(`  DELETE http://localhost:${PORT}/api/projects/:id       - 删除项目`);
  console.log('');
  console.log('示例请求:');
  console.log(`  curl -X POST http://localhost:${PORT}/api/coding \\`);
  console.log('    -H "Content-Type: application/json" \\');
  console.log('    -d \'{"requirement": "实现一个用户登录页面"}\'');
});
