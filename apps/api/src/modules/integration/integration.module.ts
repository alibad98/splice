import { Module } from '@nestjs/common';
import { IntegrationController } from './integration.controller.js';
import { IntegrationService } from './integration.service.js';

/** Owns stores, merchant accounts, platform tokens and the install flow. Other modules call IntegrationService.getAccessToken. */
@Module({ controllers: [IntegrationController], providers: [IntegrationService], exports: [IntegrationService] })
export class IntegrationModule {}
