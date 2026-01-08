/**
 * 项目管理请求处理器
 */

import http from 'http';
import {
  listProjects,
  getProjectTree,
  getProjectInfo,
  persistProject,
  deleteProject,
} from '../../sub-agent/coding-agent/services/template-generator.js';
import { setJSONHeaders, sendJSONError, parseBody } from '../utils/sse.js';

/**
 * GET /api/projects - 获取项目列表
 */
export async function handleListProjects(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const projects = await listProjects();
    setJSONHeaders(res);
    res.end(JSON.stringify({ projects }));
  } catch (error) {
    const message = error instanceof Error ? error.message : '获取项目列表失败';
    sendJSONError(res, 500, message);
  }
}

/**
 * GET /api/projects/:id - 获取项目详情
 */
export async function handleGetProject(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  projectId: string
): Promise<void> {
  try {
    const info = await getProjectInfo(projectId);
    if (!info) {
      sendJSONError(res, 404, `Project not found: ${projectId}`);
      return;
    }

    const tree = await getProjectTree(projectId);
    setJSONHeaders(res);
    res.end(
      JSON.stringify({
        id: info.id,
        name: info.name,
        createdAt: info.createdAt,
        updatedAt: info.updatedAt,
        tree,
      })
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : '获取项目失败';
    sendJSONError(res, 500, message);
  }
}

/**
 * POST /api/projects/:id/persist - 持久化项目
 */
export async function handlePersistProject(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  projectId: string
): Promise<void> {
  try {
    const body = await parseBody(req);
    const projectName = body.name || undefined;

    const path = await persistProject(projectId, projectName);
    setJSONHeaders(res);
    res.end(
      JSON.stringify({
        success: true,
        projectId,
        path,
      })
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : '持久化项目失败';
    sendJSONError(res, 500, message);
  }
}

/**
 * DELETE /api/projects/:id - 删除项目
 */
export async function handleDeleteProject(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  projectId: string
): Promise<void> {
  try {
    const success = await deleteProject(projectId);
    if (!success) {
      sendJSONError(res, 404, `Project not found: ${projectId}`);
      return;
    }

    setJSONHeaders(res);
    res.end(JSON.stringify({ success: true }));
  } catch (error) {
    const message = error instanceof Error ? error.message : '删除项目失败';
    sendJSONError(res, 500, message);
  }
}
