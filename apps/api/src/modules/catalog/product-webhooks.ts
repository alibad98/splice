// Applies Salla product webhooks to the catalog (Story 2.4). Registered on the integration inbox for the `product` kind.
// The webhook's own data is used when it was readable (no API call); the product is fetched by id only when it was not.
// Writes run in the store's context under one advisory lock per store, guarded on `source_updated_at`, and announce a
// change of a manifest-visible field with `catalog.product.updated` in the same transaction.
import { withStoreContext } from '@slips/db';
import type { Pool } from 'pg';
import { z } from 'zod';
import { publishEvent, type EventSender } from '../../events/outbox.js';
import type { CanonicalProduct, CommercePlatform } from '../../ports/commerce-platform.js';
import { Metric, type Telemetry } from '../../ports/telemetry.js';
import { InvalidWebhookPayloadError } from '../integration/errors.js';
import type { InboxEventInput, WebhookInbox } from '../integration/webhook-inbox.js';
import type { AccessTokenSource } from './catalog-sync.js';
import { CatalogRepository } from './catalog.repository.js';
import { toProductWrites } from './product-writes.js';

/** The canonical product as the platform adapter stored it in the inbox payload (dates as ISO text). */
const StoredProduct = z.object({
  externalId: z.string().min(1),
  name: z.string().min(1),
  imageUrl: z.string().nullable(),
  categories: z.array(z.object({ externalId: z.string(), name: z.string() })),
  price: z.string(),
  salePrice: z.string().nullable(),
  currency: z.string().min(3),
  taxInclusive: z.boolean(),
  stock: z.number().int().nullable(),
  hasRequiredOptions: z.boolean(),
  visible: z.boolean(),
  sourceUpdatedAt: z.coerce.date().optional(),
});

/** Hand product webhooks to catalog: the inbox knows only that some module consumes the `product` kind. Used by the API and the worker. */
export function registerProductWebhooks(inbox: { onKind: WebhookInbox['onKind'] }, tokens: AccessTokenSource, pool: Pool, platform: CommercePlatform, telemetry: Telemetry, events: EventSender): void {
  inbox.onKind('product', new ProductWebhooks(pool, platform, tokens, telemetry, events).handle);
}

export class ProductWebhooks {
  private readonly repo = new CatalogRepository();

  constructor(
    private readonly pool: Pool,
    private readonly platform: CommercePlatform,
    private readonly tokens: AccessTokenSource,
    private readonly telemetry: Telemetry,
    private readonly events: EventSender,
    private readonly now: () => number = Date.now,
  ) {}

  /** The inbox consumer. Throws to have the inbox retry; `InvalidWebhookPayloadError` dead-letters at once. */
  readonly handle = async (input: InboxEventInput): Promise<void> => {
    const { storeId, payload } = input;
    const productId = payload.product_id;
    if (payload.invalid === true || typeof productId !== 'string' || productId === '') throw new InvalidWebhookPayloadError('product webhook without a readable product id');
    const product = await this.canonical(storeId, productId, payload.product);
    // The product's own change time orders writes; without it, the platform's event time, then now.
    const fallbackAt = input.occurredAt ?? new Date(this.now());
    const { products, categories, rejected } = toProductWrites(this.platform.platform, [product], fallbackAt);
    const write = products[0];
    if (!write) throw new InvalidWebhookPayloadError(rejected.unknownCurrency > 0 ? 'product has an unknown currency' : 'product has an unreadable amount');

    const result = await withStoreContext(this.pool, storeId, async (ctx) => {
      await this.repo.lockProductWrites();
      // Categories before the product, the same lock order as a full sync page, so the two can not deadlock.
      // Each category is guarded on its own `source_updated_at`, so a stale product does not make its categories stale.
      await this.repo.upsertCategories(categories);
      const applied = await this.repo.applyProduct(write);
      if (applied.outcome === 'stale') return applied;
      if (applied.changed.length > 0) {
        await publishEvent(ctx, this.events, this.telemetry, 'catalog.product.updated', {
          v: 1,
          store_id: storeId,
          product_id: applied.productId,
          external_id: write.externalId,
          changed: applied.changed,
          name: write.name,
          image_url: write.imageUrl,
          price_minor: write.priceMinor,
          sale_price_minor: write.salePriceMinor,
          currency: write.currency,
          availability: write.availability,
          has_required_options: write.hasRequiredOptions,
          visible: write.visible,
        });
      }
      return applied;
    });
    if (result.outcome === 'stale') this.telemetry.counter(Metric.CatalogStaleWrites, { source: 'webhook' });
    this.telemetry.log.info('product webhook applied', { store_id: storeId, outcome: result.outcome, changed: result.changed, external_id: productId, event_id: input.eventId });
  };

  private async canonical(storeId: string, productId: string, stored: unknown): Promise<CanonicalProduct> {
    if (stored !== undefined) {
      const parsed = StoredProduct.safeParse(stored);
      if (parsed.success) {
        const { sourceUpdatedAt, ...rest } = parsed.data;
        return { ...rest, ...(sourceUpdatedAt ? { sourceUpdatedAt } : {}) };
      }
    }
    // Unreadable data: ask the platform. Failures propagate and the inbox retries.
    const accessToken = await this.tokens.getAccessToken(storeId);
    return this.platform.products.get({ storeId, accessToken }, productId);
  }
}
