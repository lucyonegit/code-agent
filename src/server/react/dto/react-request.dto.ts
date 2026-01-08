/**
 * ReAct 请求 DTO
 */

import { IsString, IsArray, IsOptional } from 'class-validator';

export class ReactRequestDto {
  @IsString()
  input!: string;

  @IsArray()
  @IsOptional()
  tools?: string[];

  @IsArray()
  @IsOptional()
  history?: any[];
}
