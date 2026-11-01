import { Module } from '@nestjs/common';
import { IntegrationModule } from '../integration/integration.module.js';
import { SessionModule } from '../session/session.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { CredentialsController } from './credentials.controller.js';
import { CredentialsService } from './credentials.service.js';

@Module({
  imports: [IntegrationModule, SessionModule],
  controllers: [AuthController, CredentialsController],
  providers: [AuthService, CredentialsService],
  exports: [AuthService, CredentialsService],
})
export class AuthModule {}

