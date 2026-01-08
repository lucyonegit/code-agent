/**
 * 持久化项目请求 DTO
 */

import { IsString, IsOptional } from 'class-validator';

export class PersistProjectDto {
  @IsString()
  @IsOptional()
  name?: string;
}
