import { Module } from '@nestjs/common';
import { IntegrationModule } from '../integration/integration.module.js';
import { SessionModule } from '../session/session.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';

@Module({ imports: [IntegrationModule, SessionModule], controllers: [AuthController], providers: [AuthService] })
export class AuthModule {}
