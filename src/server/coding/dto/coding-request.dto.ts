/**
 * Coding 请求 DTO
 */

import { IsString, IsBoolean, IsOptional } from 'class-validator';

export class CodingRequestDto {
  @IsString()
  requirement!: string;

  @IsBoolean()
  @IsOptional()
  useRag?: boolean;

  @IsString()
  @IsOptional()
  projectId?: string;
}
