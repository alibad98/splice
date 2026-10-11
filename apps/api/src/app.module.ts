import { Module, type DynamicModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { TelemetryExceptionFilter } from './adapters/telemetry/http.js';
import { MetricsModule } from './adapters/telemetry/metrics.module.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { SessionModule } from './modules/session/session.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { IntegrationModule } from './modules/integration/integration.module.js';
import { InfraModule, type InfraDeps } from './infra.module.js';

@Module({})
export class AppModule {
  static register(deps: InfraDeps): DynamicModule {
    return {
      module: AppModule,
      imports: [InfraModule.register(deps), HealthModule, SessionModule, IntegrationModule, AuthModule, AdminModule, MetricsModule],
      providers: [{ provide: APP_FILTER, useValue: new TelemetryExceptionFilter(deps.telemetry) }],
    };
  }
}
