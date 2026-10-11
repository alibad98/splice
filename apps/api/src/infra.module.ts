import { Global, Module, type DynamicModule } from '@nestjs/common';
import type { Pool } from 'pg';
import type { EventSender } from './events/outbox.js';
import { COMMERCE_PLATFORM, type CommercePlatform } from './ports/commerce-platform.js';
import { TOKEN_CIPHER, type TokenCipher } from './ports/token-cipher.js';
import { DATABASE_PROBE, type DatabaseProbe } from './ports/database-probe.js';
import { FEATURE_FLAGS, type FeatureFlags } from './ports/feature-flags.js';
import { TELEMETRY, type Telemetry } from './ports/telemetry.js';

export const APP_INFO = Symbol('APP_INFO');
export const METRICS_ENDPOINT = Symbol('METRICS_ENDPOINT');
export const DB_POOL = Symbol('DB_POOL');
export const EVENT_SENDER = Symbol('EVENT_SENDER');
export const INTEGRATION_CONFIG = Symbol('INTEGRATION_CONFIG');

export interface IntegrationConfig {
  /** Where the merchant lands after the install flow. */
  dashboardUrl: string;
  /** HMAC key for the OAuth `state`, derived from the master key; never logged. */
  stateSecret: Buffer;
  /** Set the Secure flag on the state cookie. */
  secureCookies: boolean;
}

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
  /** Pool for domain data (stores, tokens). Connects lazily. */
  pool: Pool;
  /** Where domain events are enqueued: a send-only pg-boss producer in the http role. */
  events: EventSender;
  cipher: TokenCipher;
  platform: CommercePlatform;
  integration: IntegrationConfig;
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
      { provide: DB_POOL, useValue: deps.pool },
      { provide: EVENT_SENDER, useValue: deps.events },
      { provide: TOKEN_CIPHER, useValue: deps.cipher },
      { provide: COMMERCE_PLATFORM, useValue: deps.platform },
      { provide: INTEGRATION_CONFIG, useValue: deps.integration },
    ];
    return { module: InfraModule, providers, exports: providers.map((p) => p.provide) };
  }
}
