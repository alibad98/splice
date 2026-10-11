import { Global, Module, type DynamicModule } from '@nestjs/common';
import { DATABASE_PROBE, type DatabaseProbe } from './ports/database-probe.js';
import { FEATURE_FLAGS, type FeatureFlags } from './ports/feature-flags.js';
import { TELEMETRY, type Telemetry } from './ports/telemetry.js';

export const APP_INFO = Symbol('APP_INFO');
export const METRICS_ENDPOINT = Symbol('METRICS_ENDPOINT');

export interface AppInfo {
  version: string;
}

export interface MetricsEndpoint {
  render(): string;
  /** Bearer token; the endpoint answers 404 when undefined. */
  token: string | undefined;
}

export interface InfraDeps {
  telemetry: Telemetry;
  probe: DatabaseProbe;
  flags: FeatureFlags;
  info: AppInfo;
  metrics: MetricsEndpoint;
}

/** Binds the ports to their adapters for the Nest container. Global so domain modules just inject tokens. */
@Global()
@Module({})
export class InfraModule {
  static register(deps: InfraDeps): DynamicModule {
    const providers = [
      { provide: TELEMETRY, useValue: deps.telemetry },
      { provide: DATABASE_PROBE, useValue: deps.probe },
      { provide: FEATURE_FLAGS, useValue: deps.flags },
      { provide: APP_INFO, useValue: deps.info },
      { provide: METRICS_ENDPOINT, useValue: deps.metrics },
    ];
    return { module: InfraModule, providers, exports: providers.map((p) => p.provide) };
  }
}
