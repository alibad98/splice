import { Inject, Injectable, Module, forwardRef, type OnModuleInit } from '@nestjs/common';
import type { Pool } from 'pg';
import { DB_POOL, EVENT_SENDER } from '../../infra.module.js';
import { COMMERCE_PLATFORM, type CommercePlatform } from '../../ports/commerce-platform.js';
import { TELEMETRY, type Telemetry } from '../../ports/telemetry.js';
import type { EventSender } from '../../events/outbox.js';
import { ContentModule } from '../content/content.module.js';
import { IntegrationModule } from '../integration/integration.module.js';
import { IntegrationService } from '../integration/integration.service.js';
import { CatalogController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';
import { registerProductWebhooks } from './product-webhooks.js';

/** Hands product webhooks to catalog: the inbox (integration) knows only that some module consumes the `product` kind. */
@Injectable()
export class ProductWebhookRegistration implements OnModuleInit {
  constructor(
    @Inject(DB_POOL) private readonly pool: Pool,
    @Inject(COMMERCE_PLATFORM) private readonly platform: CommercePlatform,
    @Inject(TELEMETRY) private readonly telemetry: Telemetry,
    @Inject(EVENT_SENDER) private readonly events: EventSender,
    @Inject(IntegrationService) private readonly integration: IntegrationService,
  ) {}

  onModuleInit(): void {
    registerProductWebhooks(this.integration.inbox, this.integration, this.pool, this.platform, this.telemetry, this.events);
  }
}

/** Product catalog (Epic 2). The sync itself runs in the worker role (catalog-jobs); the http role serves the reads. */
// Catalog and content import each other (Story 3.4: content reads product summaries, catalog reads link counts).
@Module({ imports: [forwardRef(() => ContentModule), IntegrationModule], controllers: [CatalogController], providers: [CatalogService, ProductWebhookRegistration], exports: [CatalogService] })
export class CatalogModule {}
