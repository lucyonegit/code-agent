/**
 * 项目管理控制器
 */

import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Inject,
} from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { PersistProjectDto } from './dto/persist-project.dto';

@Controller('api/projects')
export class ProjectsController {
  constructor(@Inject(ProjectsService) private readonly projectsService: ProjectsService) { }

  /**
   * GET /api/projects - 获取项目列表
   */
  @Get()
  async list() {
    const projects = await this.projectsService.list();
    return { projects };
  }

  /**
   * GET /api/projects/:id - 获取项目详情
   */
  @Get(':id')
  async getById(@Param('id') id: string) {
    return await this.projectsService.getById(id);
  }

  /**
   * POST /api/projects/:id/persist - 持久化项目
   */
  @Post(':id/persist')
  async persist(@Param('id') id: string, @Body() dto: PersistProjectDto) {
    return await this.projectsService.persist(id, dto.name);
  }

  /**
   * DELETE /api/projects/:id - 删除项目
   */
  @Delete(':id')
  async delete(@Param('id') id: string) {
    return await this.projectsService.delete(id);
  }
}
