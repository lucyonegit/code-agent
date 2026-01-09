/**
 * 项目管理服务
 */

import { Injectable, NotFoundException } from '@nestjs/common';
import {
  listProjects,
  getProjectTree,
  getProjectInfo,
  persistProject,
  deleteProject,
} from '../../sub-agent/coding-agent/services/template-generator';
import { conversationStorage } from '../../sub-agent/coding-agent/services/conversation-manager';

@Injectable()
export class ProjectsService {
  /**
   * 获取项目列表
   */
  async list() {
    return await listProjects();
  }

  /**
   * 获取项目详情（包含对话记录）
   */
  async getById(projectId: string) {
    const info = await getProjectInfo(projectId);
    if (!info) {
      throw new NotFoundException(`Project not found: ${projectId}`);
    }

    const tree = await getProjectTree(projectId);

    // 加载对话记录
    const conversation = await conversationStorage.load(projectId);

    return {
      id: info.id,
      name: info.name,
      createdAt: info.createdAt,
      updatedAt: info.updatedAt,
      tree,
      conversation: conversation?.messages || [],
    };
  }

  /**
   * 持久化项目
   */
  async persist(projectId: string, projectName?: string) {
    const path = await persistProject(projectId, projectName);
    return {
      success: true,
      projectId,
      path,
    };
  }

  /**
   * 删除项目
   */
  async delete(projectId: string) {
    const success = await deleteProject(projectId);
    if (!success) {
      throw new NotFoundException(`Project not found: ${projectId}`);
    }
    return { success: true };
  }
}
