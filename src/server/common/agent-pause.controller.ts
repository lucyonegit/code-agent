/**
 * Agent 恢复端点 — 通用，不包含业务逻辑
 *
 * POST /api/agent/resume
 * Body: { sessionId: string, payload: Record<string, any> }
 */

import { Controller, Post, Body, NotFoundException } from '@nestjs/common';
import { IsString, IsObject } from 'class-validator';
import { agentPauseController } from '../../core/agent-pause';

/** 恢复请求 DTO */
class AgentResumeDto {
  @IsString()
  sessionId!: string;

  @IsObject()
  payload!: Record<string, any>;
}

@Controller('api/agent')
export class AgentPauseController {
  @Post('resume')
  async resume(@Body() dto: AgentResumeDto) {
    console.log(`[AgentPauseController] Resume request for session: ${dto.sessionId}`);

    const resolved = agentPauseController.resume(dto.sessionId, dto.payload);

    if (!resolved) {
      throw new NotFoundException(
        `Pause session "${dto.sessionId}" not found or expired`
      );
    }

    return { success: true };
  }
}
