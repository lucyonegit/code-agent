/**
 * NestJS 服务器启动入口
 */

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { isLangfuseEnabled } from '../core/langfuse';

const PORT = 3002; // 使用不同端口进行并行测试

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 全局 CORS 配置
  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type',
  });

  // 全局验证管道
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
    })
  );

  // 全局异常过滤器
  app.useGlobalFilters(new HttpExceptionFilter());

  await app.listen(PORT);

  console.log(`🚀 NestJS Agent Server running at http://localhost:${PORT}`);

  if (isLangfuseEnabled()) {
    console.log('📊 Langfuse 监控已启用');
  }
  console.log('');
  console.log('可用接口:');
  console.log(`  GET  http://localhost:${PORT}/health           - 健康检查`);
  console.log(`  GET  http://localhost:${PORT}/api/tools        - 获取可用工具`);
  console.log(`  POST http://localhost:${PORT}/api/react        - ReAct 执行 (SSE)`);
  console.log(`  POST http://localhost:${PORT}/api/planner      - Planner 执行 (SSE)`);
  console.log(`  POST http://localhost:${PORT}/api/coding       - Coding 执行 (SSE)`);
  console.log('');
  console.log('项目管理接口:');
  console.log(`  GET    http://localhost:${PORT}/api/projects           - 获取项目列表`);
  console.log(`  GET    http://localhost:${PORT}/api/projects/:id       - 获取项目详情`);
  console.log(`  POST   http://localhost:${PORT}/api/projects/:id/persist - 持久化项目`);
  console.log(`  DELETE http://localhost:${PORT}/api/projects/:id       - 删除项目`);
}

bootstrap();
