/**
 * Planner 请求 DTO
 */

import { IsString, IsArray, IsOptional } from 'class-validator';

export class PlannerRequestDto {
  @IsString()
  goal!: string;

  @IsString()
  @IsOptional()
  conversationId?: string;

  @IsArray()
  @IsOptional()
  tools?: string[];
}
