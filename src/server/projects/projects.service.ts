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

@Injectable()
export class ProjectsService {
  /**
   * 获取项目列表
   */
  async list() {
    return await listProjects();
  }

  /**
   * 获取项目详情
   */
  async getById(projectId: string) {
    const info = await getProjectInfo(projectId);
    if (!info) {
      throw new NotFoundException(`Project not found: ${projectId}`);
    }

    const tree = await getProjectTree(projectId);
    return {
      id: info.id,
      name: info.name,
      createdAt: info.createdAt,
      updatedAt: info.updatedAt,
      tree,
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
