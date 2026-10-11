import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from './app.module.js';
import type { Env } from './config/env.js';

export async function createHttpApp(env: Pick<Env, 'CORS_ORIGINS'>): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  app.enableCors({ origin: env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean) });
  app.enableShutdownHooks();
  return app;
}
