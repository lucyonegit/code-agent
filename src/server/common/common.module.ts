/**
 * 通用模块 - 提供全局可用的过滤器、管道、拦截器等
 */

import { Module, Global } from '@nestjs/common';

@Global()
@Module({
  providers: [],
  exports: [],
})
export class CommonModule { }
