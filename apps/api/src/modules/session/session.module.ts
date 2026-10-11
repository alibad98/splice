import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AccessGuard } from './access.guard.js';
import { SessionService } from './session.service.js';

/** Merchant sessions and the global access guard. Depends on nothing but infrastructure, so any module can import it. */
@Module({ providers: [SessionService, { provide: APP_GUARD, useClass: AccessGuard }], exports: [SessionService] })
export class SessionModule {}
