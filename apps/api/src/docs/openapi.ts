import {
  AUTH_PROBLEM_CODES,
  CONTENT_CTA_URL_NOT_STORE_DOMAIN,
  CONTENT_INVALID_LAYOUT,
  CONTENT_INVALID_TRANSITION,
  CONTENT_UNSUPPORTED_FORMAT,
  CONTENT_PRODUCT_NOT_LINKABLE,
  CONTENT_SLIDE_ALT_REQUIRED,
  ContentProductSummary,
  ContentSlide,
  StoreManifest,
  ManifestItem,
  ManifestSlide,
  ManifestRendition,
  SLIDES_MAX,
  SLIDE_ALT_MAX,
  CatalogSyncStatus,
  CategoryListResponse,
  ConnectionStatus,
  ContentCreateInput,
  ContentItem,
  CONTENT_PAGE_SIZE,
  CONTENT_PAGE_SIZES,
  CONTENT_SEARCH_MAX,
  ContentListQuery,
  ContentListResponse,
  ContentUpdateInput,
  EmbeddedSession,
  ForgotPasswordInput,
  HealthResponse,
  LoginInput,
  MEDIA_LIMITS,
  MEDIA_NOT_ATTACHABLE,
  MEDIA_TOO_LARGE,
  MEDIA_TYPE_NOT_ALLOWED,
  MEDIA_UPLOAD_EXPIRED,
  MEDIA_UPLOAD_MISSING,
  MEDIA_UPLOAD_RATE_LIMITED,
  MEDIA_URL_NOT_ALLOWED,
  MEDIA_IMPORT_URL_MAX,
  MediaAsset,
  MediaImportRequest,
  MediaUploadGrant,
  MediaUploadRequest,
  OtpPurpose,
  PRODUCT_PAGE_SIZE,
  PRODUCT_PAGE_SIZES,
  PRODUCT_SEARCH_MAX,
  ProductListQuery,
  ProductListResponse,
  ProductRow,
  ResendOtpInput,
  ResetPasswordInput,
  SESSION_PROBLEM_CODES,
  SelectStoreInput,
  SessionInfo,
  SetPasswordInput,
  StoreChoice,
  VerifyOtpInput,
  VerifyOtpResponse,
} from '@slips/contracts';
import { z } from 'zod';

/**
 * OpenAPI 3.0 description of the HTTP API. Every model is a named schema under `components.schemas`, generated from
 * the same Zod contracts the API validates with, so docs cannot drift from the code. Every route a controller declares
 * must appear in ROUTES (openapi.test.ts).
 */

// ---------------------------------------------------------------------------------------------------------------
// Models. Request bodies are exported in their input shape (defaults optional), responses in their output shape.
// ---------------------------------------------------------------------------------------------------------------

const Problem = z.object({
  type: z.string().describe('A stable problem type slug when the error has one (e.g. `sync-rate-limited`, `invalid-transition`), else `about:blank`.'),
  title: z.string().describe('Short human-readable summary (English; the dashboard shows its own localized copy).'),
  status: z.number().int().describe('HTTP status code.'),
  detail: z.string().optional().describe('More detail, for 4xx responses.'),
  code: z.string().optional().describe('Stable machine-readable reason. See "Errors" in the introduction for the full list.'),
});

const OkMessage = z.object({ ok: z.literal(true), message: z.string().describe('Neutral confirmation (never reveals whether the email exists).') });

const SignInResult = z.union([
  z.object({ ok: z.literal(true), session: SessionInfo }),
  z.object({
    ok: z.literal(true),
    select_store: z.object({
      selection_token: z.string().describe('Short-lived token for `POST /v1/auth/login/select`.'),
      stores: z.array(StoreChoice).min(2),
    }),
  }),
]);

const EmbeddedSignInRequest = z.object({ token: z.string().min(1).max(4096).describe('Token from the Salla embedded SDK `getToken()`.') });

const CatalogSyncState = CatalogSyncStatus;

const outputs: Array<[z.ZodType, string, string]> = [
  [StoreManifest, 'StoreManifest', 'Version 1 publishing manifest with resolved URLs and ordered slides.'],
  [ManifestItem, 'ManifestItem', 'One saved content item with its current linked product snapshot.'],
  [ManifestSlide, 'ManifestSlide', 'A slide with explicit null URLs and empty renditions when media is unavailable.'],
  [ManifestRendition, 'ManifestRendition', 'A resolved rendition with profile, content type and dimensions.'],
  [Problem, 'Problem', 'RFC 9457 problem details. Every error response uses this shape with `application/problem+json`.'],
  [HealthResponse, 'Health', 'Process liveness and dependency checks.'],
  [ConnectionStatus, 'ConnectionStatus', 'Whether the store is connected to Salla (shell connection chip).'],
  [SessionInfo, 'SessionInfo', 'The signed-in merchant session.'],
  [EmbeddedSession, 'EmbeddedSession', 'Short-lived bearer for the embedded (iframe) dashboard. Keep it in memory only.'],
  [StoreChoice, 'StoreChoice', 'A store the signed-in login can open.'],
  [SignInResult, 'SignInResult', 'Either signed in (`session`; the `slips_session` cookie is set on the same response), or the login opens several stores and one must be chosen (`select_store`).'],
  [OtpPurpose, 'OtpPurpose', '`setup`: first password for a new owner. `reset`: forgotten password.'],
  [VerifyOtpResponse, 'VerifyOtpResult', 'Token to send with `reset-password` (purpose `reset`) or `set-password` (purpose `setup`).'],
  [OkMessage, 'OkMessage', 'Plain confirmation.'],
  [ProductRow, 'Product', 'One product row. Money is integer minor units of `currency` (e.g. SAR 120.50 = 12050).'],
  [ProductListResponse, 'ProductPage', `One page of products: \`items\` (at most \`page_size\`), \`total\` matching products, \`page\` (1-based) and \`page_size\`.`],
  [CategoryListResponse, 'CategoryList', "The store's categories for the Products filter."],
  [CatalogSyncState, 'CatalogSyncStatus', 'Latest catalog sync run. `never` until the first one; `queued` until the worker starts a requested run.'],
  [ContentProductSummary, 'ContentProduct', 'The product linked to a content item, as the catalog has it now. `deleted`: the product was deleted in the store (the item shows "Linked product deleted"); it clears if the product is re-created.'],
  [ContentSlide, 'ContentSlide', "One slide of a content item: its media asset, the asset's `kind`, the alt text, the asset's current `status` (and `failure_reason` when `failed`), and `source_url`, the link an imported asset came from (null for uploads)."],
  [ContentItem, 'ContentItem', 'One content item (Story or Reel), its lifecycle status, its linked `product` (or null) and its ordered `slides`.'],
  [MediaUploadGrant, 'MediaUploadGrant', 'A pre-signed upload: PUT the file to `url` with `headers` before `expires_at` (15 minutes). The URL signs `Content-Length`, `Content-Type` and `x-amz-checksum-sha256`, so only the declared file is accepted.'],
  [MediaAsset, 'MediaAsset', 'An uploaded or imported media file and its status: `importing` (the link is being fetched; `content_type` and `size_bytes` are null until it is), `uploaded` (waiting for inspection), `scanned` (type checked, metadata stripped, malware-scanned), `processed` (publishable) or `failed` with `failure_reason`.'],
  [ContentListResponse, 'ContentPage', 'One page of content items for a tab: `items` (at most `page_size`), `total` matching items, `page`, `page_size`, and `counts` for every tab (counts ignore search and page).'],
];

const inputs: Array<[z.ZodType, string, string]> = [
  [OtpPurpose, 'OtpPurpose', '`setup`: first password for a new owner. `reset`: forgotten password.'],
  [EmbeddedSignInRequest, 'EmbeddedSignInRequest', 'Host token from the Salla iframe.'],
  [LoginInput, 'LoginRequest', 'Email and password.'],
  [SelectStoreInput, 'SelectStoreRequest', 'Store picked after a multi-store login.'],
  [ForgotPasswordInput, 'ForgotPasswordRequest', 'Email to send a reset code to.'],
  [VerifyOtpInput, 'VerifyOtpRequest', 'The 6-digit emailed code.'],
  [ResetPasswordInput, 'ResetPasswordRequest', 'New password with the token from `verify-otp`.'],
  [SetPasswordInput, 'SetPasswordRequest', "Owner's first password with the token from `verify-otp`."],
  [ResendOtpInput, 'ResendOtpRequest', 'Send the code again.'],
  [ContentCreateInput, 'ContentCreateRequest', 'Create a draft Story or Reel with its CTA and, optionally, the one linked product (`product_id`) and its ordered `slides`.'],
  [MediaImportRequest, 'MediaImportRequest', '`kind` and the link to import: http or https, port 80 or 443, no user info, at most ' + MEDIA_IMPORT_URL_MAX + ' characters.'],
  [MediaUploadRequest, 'MediaUploadRequest', "`kind`, the file's `content_type`, its exact `size_bytes` and its SHA-256 (64 lower-case hex characters)."],
  [ContentUpdateInput, 'ContentUpdateRequest', 'Any non-empty subset of the editable fields (title, format, CTA, `product_id`; `null` unlinks; `slides` replaces the whole slide list). The open-link rule applies to the merged item.'],
];

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const refFor = (s: z.ZodType, list: Array<[z.ZodType, string, string]>) => {
  const hit = list.find(([schema]) => schema === s);
  if (!hit) throw new Error('openapi: schema is not registered as a named model');
  return ref(hit[1]);
};

/** Drop generator noise Swagger UI renders badly: `$id`, the 2^53 bounds and zod's long UUID regex. */
function tidy(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(tidy);
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === '$id' || k === '$schema') continue;
    if ((k === 'maximum' && v === Number.MAX_SAFE_INTEGER) || (k === 'minimum' && v === Number.MIN_SAFE_INTEGER)) continue;
    if (k === 'pattern' && (node as { format?: string }).format === 'uuid') continue;
    out[k] = tidy(v);
  }
  return out;
}

function exportModels(list: Array<[z.ZodType, string, string]>, io: 'input' | 'output'): Record<string, unknown> {
  const registry = z.registry<{ id: string; description: string }>();
  for (const [schema, id, description] of list) registry.add(schema, { id, description });
  const { schemas } = z.toJSONSchema(registry, { target: 'openapi-3.0', io, unrepresentable: 'any', uri: (id) => `#/components/schemas/${id}` }) as { schemas: Record<string, unknown> };
  return tidy(schemas) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------------------------------------------

type Method = 'get' | 'post' | 'patch' | 'delete';
type Auth = 'public' | 'merchant' | 'admin';

interface QueryDoc {
  /** The contract schema the controller validates the query with. */
  schema: z.ZodObject;
  descriptions: Record<string, string>;
  examples?: Record<string, unknown>;
}

export interface RouteDoc {
  method: Method;
  path: string;
  tag: string;
  summary: string;
  description?: string;
  auth: Auth;
  query?: QueryDoc;
  body?: z.ZodType;
  success: { status: number; description: string; body?: z.ZodType; contentType?: string; headers?: Record<string, string>; example?: unknown };
  errors?: number[];
}

const MB = 1024 * 1024;

const PLACEMENTS_DOC = `\`placements\` holds at most one Home placement (\`{ type: 'home', layout? }\`). The controlled pilot delivers the fixed Story Ring only: an omitted \`layout\` keeps the saved layout, or takes the store display default (Ring when the store has no settings). Any other or unknown \`layout\` answers 422 with problem \`type\` \`${CONTENT_INVALID_LAYOUT}\` (code \`invalid_layout\`) and nothing is written.`;
const SLIDES_DOC = `\`slides\` (at most ${SLIDES_MAX}, unique \`media_asset_id\`s) replaces the item's slide list in order: removed slides are soft-deleted and a re-added asset revives its slide. Each asset must be a non-failed media asset of the store, else 422 with problem \`type\` \`${MEDIA_NOT_ATTACHABLE}\`; image slides need \`alt_text\` (1-${SLIDE_ALT_MAX} characters), else 422 \`${CONTENT_SLIDE_ALT_REQUIRED}\`.`;

const productExample = {
  v: 1,
  total: 120,
  page: 2,
  page_size: PRODUCT_PAGE_SIZE,
  items: [
    {
      id: '01a1974e-2656-76b1-b0fd-3032c36f0c07',
      external_id: '1185623914',
      name: 'عباية كريب سوداء',
      image_url: 'https://cdn.salla.sa/abaya.jpg',
      category_name: 'عبايات',
      more_categories: 1,
      price_minor: 34000,
      sale_price_minor: 29900,
      currency: 'SAR',
      tax_inclusive: true,
      availability: 'low',
      has_required_options: false,
      linked_content_count: 2,
      attributed_orders: null,
    },
  ],
};

export const ROUTES: RouteDoc[] = [
  { method: 'get', path: '/v1/preview/content/:id', tag: 'Content', summary: 'Preview one saved content item', description: 'Any live item of the session store, regardless of status, schedule or placement. No writes or events. Media URLs are API-relative and require the API origin and merchant credentials. Only inspected media is exposed; importing, uploaded and failed assets are placeholders. Missing, malformed, deleted and other-store IDs return 404.', auth: 'merchant', success: { status: 200, description: 'One-item StoreManifest v1', body: StoreManifest, headers: { 'Cache-Control': 'private, no-store' } }, errors: [401, 404] },
  { method: 'get', path: '/v1/media/:id/source', tag: 'Media', summary: 'Stream inspected media source', description: 'Streams only the sanitized malware-scanned storage copy of a scanned or processed asset of the session store. Never streams raw uploads or imported external links. Unavailable, unsafe and missing objects return 404.', auth: 'merchant', success: { status: 200, description: 'Inspected source bytes', contentType: 'application/octet-stream', headers: { 'Cache-Control': 'private, no-store' } }, errors: [401, 404] },
  { method: 'get', path: '/v1/media/:id/renditions/:profile', tag: 'Media', summary: 'Stream a media rendition', description: 'Profiles: web for images; 480p, 720p, 1080p and poster for processed videos. While scanned, only an available image web rendition or video poster may be used. Requires merchant credentials; other-store, unknown profiles, unsafe assets and missing objects return 404. Content-Type reflects the stored rendition.', auth: 'merchant', success: { status: 200, description: 'Selected rendition bytes', contentType: 'application/octet-stream', headers: { 'Cache-Control': 'private, no-store' } }, errors: [401, 404] },
  { method: 'get', path: '/v1/health', tag: 'Ops', summary: 'Health check', description: 'Liveness plus a database check. 503 when the database is down.', auth: 'public', success: { status: 200, description: 'Healthy', body: HealthResponse }, errors: [503] },
  { method: 'get', path: '/metrics', tag: 'Ops', summary: 'Prometheus metrics', description: 'Needs `Authorization: Bearer <METRICS_TOKEN>`. Disabled when the token is not configured.', auth: 'public', success: { status: 200, description: 'Prometheus text exposition format', contentType: 'text/plain' }, errors: [401] },

  { method: 'get', path: '/v1/integrations/salla/install', tag: 'Salla install', summary: '1. Start install / sign-in with Salla', description: 'Sets a short-lived state cookie and redirects the browser to Salla\'s consent screen. Open it in the browser; it is not an XHR endpoint.', auth: 'public', success: { status: 302, description: 'Redirect to Salla OAuth consent', headers: { Location: 'Salla consent URL' } }, errors: [503] },
  { method: 'get', path: '/v1/integrations/salla/callback', tag: 'Salla install', summary: '2. OAuth callback', description: 'Salla redirects here with `code` and `state`. The API stores the store and its tokens (encrypted), signs the merchant in with the `slips_session` cookie, and redirects to the dashboard with `?connected=1`, or `?install_error=<reason>` on failure.', auth: 'public', success: { status: 302, description: 'Redirect to the dashboard', headers: { Location: 'Dashboard URL', 'Set-Cookie': '`slips_session` on success' } } },
  { method: 'get', path: '/v1/integrations/salla/mock-consent', tag: 'Salla install', summary: 'Dev only: consent simulator', description: 'Stands in for Salla when no Salla credentials are configured. 404 otherwise.', auth: 'public', success: { status: 200, description: 'HTML form', contentType: 'text/html' }, errors: [400, 404] },
  { method: 'post', path: '/v1/webhooks/salla', tag: 'Salla install', summary: 'Salla webhooks', description: 'Called by Salla, not by clients. The `X-Salla-Signature` HMAC over the raw body is verified; the event is stored and processed by the worker (install, uninstall, products).', auth: 'public', success: { status: 200, description: 'Accepted' }, errors: [401] },

  { method: 'post', path: '/v1/session/embedded', tag: 'Session', summary: 'Embedded sign-in (Salla iframe)', description: 'Trade the Salla host token for a short-lived bearer. Send it as `Authorization: Bearer …` and call again with a fresh host token before `expires_in` runs out.', auth: 'public', body: EmbeddedSignInRequest, success: { status: 200, description: 'Bearer', body: EmbeddedSession }, errors: [400, 401, 403, 503] },
  { method: 'get', path: '/v1/session', tag: 'Session', summary: 'Current session', description: 'Who is signed in, the Salla connection status, and for cookie sessions the CSRF token to send on POST requests.', auth: 'merchant', success: { status: 200, description: 'Session', body: SessionInfo }, errors: [401] },
  { method: 'post', path: '/v1/session/sign-out', tag: 'Session', summary: 'Sign out', description: 'Ends the session immediately (bearer or cookie). Cookie sessions need `x-csrf-token`.', auth: 'merchant', success: { status: 204, description: 'Signed out' }, errors: [401, 403] },

  { method: 'post', path: '/v1/auth/login', tag: 'Password sign-in', summary: '1. Log in with email and password', description: 'On success sets the `slips_session` cookie and returns the session. If the login opens several stores, returns `select_store` instead: continue with `login/select`. Repeated failures lock the account for a while (429).', auth: 'public', body: LoginInput, success: { status: 200, description: 'Signed in, or choose a store', body: SignInResult }, errors: [400, 401, 429] },
  { method: 'post', path: '/v1/auth/login/select', tag: 'Password sign-in', summary: '2. Choose the store (multi-store logins)', auth: 'public', body: SelectStoreInput, success: { status: 200, description: 'Signed in', body: SignInResult }, errors: [400, 401] },
  { method: 'post', path: '/v1/auth/forgot-password', tag: 'Password reset & setup', summary: '1. Request a reset code', description: 'Emails a 6-digit code (purpose `reset`). In local dev the code is printed in the API console. Always answers the same way, whether or not the email exists.', auth: 'public', body: ForgotPasswordInput, success: { status: 200, description: 'Code sent if the email is known', body: OkMessage }, errors: [400, 429] },
  { method: 'post', path: '/v1/auth/verify-otp', tag: 'Password reset & setup', summary: '2. Verify the code', description: 'Exchanges the code for a short-lived token: use it with `reset-password` (purpose `reset`) or `set-password` (purpose `setup`, the invite sent to a new owner on install).', auth: 'public', body: VerifyOtpInput, success: { status: 200, description: 'Code accepted', body: VerifyOtpResponse }, errors: [400, 401, 429] },
  { method: 'post', path: '/v1/auth/reset-password', tag: 'Password reset & setup', summary: '3a. Set a new password (reset)', description: 'Then log in with the new password.', auth: 'public', body: ResetPasswordInput, success: { status: 200, description: 'Password changed', body: OkMessage }, errors: [400, 401] },
  { method: 'post', path: '/v1/auth/set-password', tag: 'Password reset & setup', summary: "3b. Set the owner's first password (setup)", description: 'Sets the password and signs the owner in (cookie set).', auth: 'public', body: SetPasswordInput, success: { status: 200, description: 'Signed in', body: SignInResult }, errors: [400, 401] },
  { method: 'post', path: '/v1/auth/resend-otp', tag: 'Password reset & setup', summary: 'Resend the code', auth: 'public', body: ResendOtpInput, success: { status: 200, description: 'Code sent if allowed', body: OkMessage }, errors: [400, 429] },

  {
    method: 'get',
    path: '/v1/products',
    tag: 'Catalog',
    summary: 'List products (search, filter, sort, paginate)',
    description: `Products of the signed-in store that are visible in Salla. Pages hold \`page_size\` items (${PRODUCT_PAGE_SIZES.join(', ')}; default ${PRODUCT_PAGE_SIZE}); use \`total\` and \`page_size\` to compute the page count. A page past the end returns empty \`items\` with the real \`total\`. Invalid parameters answer 400 \`invalid_query\`.`,
    auth: 'merchant',
    query: {
      schema: ProductListQuery,
      descriptions: {
        q: `Search product names (case-insensitive substring, Arabic or English; \`%\` and \`_\` match literally). Max ${PRODUCT_SEARCH_MAX} characters.`,
        category: 'Only products in this category. Use an `external_id` from `GET /v1/products/categories`.',
        sort: '`name` (default) or `price` (the effective price: sale price when set). Prefix with `-` for descending.',
        page: '1-based page number.',
        page_size: `Items per page: one of ${PRODUCT_PAGE_SIZES.join(', ')} (default ${PRODUCT_PAGE_SIZE}). Any other value is a 400.`,
      },
      examples: { q: 'عباية' },
    },
    success: { status: 200, description: 'One page of products', body: ProductListResponse, example: productExample },
    errors: [400, 401],
  },
  { method: 'get', path: '/v1/products/categories', tag: 'Catalog', summary: 'List categories', description: 'For the category filter, sorted by name.', auth: 'merchant', success: { status: 200, description: 'Categories', body: CategoryListResponse }, errors: [401] },
  { method: 'get', path: '/v1/catalog/sync', tag: 'Catalog', summary: 'Catalog sync status', description: 'Poll while `queued` or `running` (or `never`) to know when a sync has finished. `failed` is reported only after the last retry and carries a `reason`; `last_synced_at` is the last successful sync and survives failures.', auth: 'merchant', success: { status: 200, description: 'Sync status', body: CatalogSyncStatus }, errors: [401] },
  {
    method: 'post',
    path: '/v1/catalog/sync',
    tag: 'Catalog',
    summary: 'Sync products now',
    description:
      'Asks for a full import of the store\'s products from Salla and returns at once (the worker does the import). While a run is `queued` or `running` the same run is returned and nothing new is queued. A request less than a minute after the previous one answers 429 with problem `type` `sync-rate-limited` and a `Retry-After` header (seconds). Then poll `GET /v1/catalog/sync`. Cookie sessions need `x-csrf-token`.',
    auth: 'merchant',
    success: { status: 202, description: 'Run queued, or the run already in progress', body: CatalogSyncStatus },
    errors: [401, 403, 429],
  },

  {
    method: 'get',
    path: '/v1/content',
    tag: 'Content',
    summary: 'List content (tab, search, sort, paginate)',
    description: `Live (non-deleted) content items of the signed-in store for one tab, plus \`counts\` for every tab that ignore \`q\` and the page. Tabs: \`all\` (every status), \`published\`, \`scheduled\`, \`drafts\` (draft, processing, failed); archived, deactivated and ended items appear only under \`all\`. Pages hold \`page_size\` items (${CONTENT_PAGE_SIZES.join(', ')}; default ${CONTENT_PAGE_SIZE}); a page past the end returns empty \`items\` with the real \`total\`. Invalid parameters answer 400 \`invalid_query\`.`,
    auth: 'merchant',
    query: {
      schema: ContentListQuery,
      descriptions: {
        tab: '`all` (default), `published`, `scheduled` or `drafts`. Any other value is a 400.',
        q: `Search titles (case-insensitive substring; \`%\` and \`_\` match literally). Max ${CONTENT_SEARCH_MAX} characters.`,
        sort: '`-updated` (default, most recently changed first), `updated`, `title` or `-title`.',
        page: '1-based page number.',
        page_size: `Items per page: one of ${CONTENT_PAGE_SIZES.join(', ')} (default ${CONTENT_PAGE_SIZE}). Any other value is a 400.`,
      },
      examples: { q: 'عباية' },
    },
    success: { status: 200, description: 'One page of content items with tab counts', body: ContentListResponse },
    errors: [400, 401],
  },
  {
    method: 'post',
    path: '/v1/content',
    tag: 'Content',
    summary: 'Create a content item',
    description: `Creates a draft Story or Reel with its title, format and CTA, and emits \`content.item.created\` in the same transaction. Invalid bodies answer 400 \`invalid_body\`. An open-link \`cta_url\` must be http(s) on one of the store's synced domains (or a subdomain of one), else 422 with problem \`type\` \`${CONTENT_CTA_URL_NOT_STORE_DOMAIN}\`. An optional \`product_id\` links one catalog product; one the store's catalog does not know or has deleted answers 422 with problem \`type\` \`${CONTENT_PRODUCT_NOT_LINKABLE}\` and nothing is written. ${SLIDES_DOC} ${PLACEMENTS_DOC}`,
    auth: 'merchant',
    body: ContentCreateInput,
    success: { status: 201, description: 'Created draft content item', body: ContentItem },
    errors: [400, 401, 403, 422],
  },
  {
    method: 'patch',
    path: '/v1/content/:id',
    tag: 'Content',
    summary: 'Edit a content item',
    description: `Changes the title, format, CTA, linked product (\`product_id\`, one per item; \`null\` unlinks) and slides of a live item of the store, keeps its status, and emits \`content.item.edited\` in the same transaction (nothing is written when no field changes). Moving \`cta_action\` off \`open_link\` clears \`cta_url\`. Invalid bodies, or a merged item that breaks the open-link rule, answer 400 \`invalid_body\`; archived items answer 409 with problem \`type\` \`${CONTENT_INVALID_TRANSITION}\`; an off-domain \`cta_url\` answers 422 with problem \`type\` \`${CONTENT_CTA_URL_NOT_STORE_DOMAIN}\`; a \`product_id\` the store's catalog does not know or has deleted answers 422 with problem \`type\` \`${CONTENT_PRODUCT_NOT_LINKABLE}\` and nothing is written. ${SLIDES_DOC} A slide the item already has stays even if its asset failed since. ${PLACEMENTS_DOC} A layout change is one \`placements\` change in the single \`content.item.edited\` event. Changing a Published or Scheduled item's \`format\` to \`reel\` answers 422 with problem \`type\` \`${CONTENT_UNSUPPORTED_FORMAT}\` (code \`unsupported_format\`) and nothing is written. Unknown, deleted or other-store items answer 404.`,
    auth: 'merchant',
    body: ContentUpdateInput,
    success: { status: 200, description: 'Edited content item', body: ContentItem },
    errors: [400, 401, 403, 404, 409, 422],
  },
  {
    method: 'get',
    path: '/v1/content/:id',
    tag: 'Content',
    summary: 'Get a content item',
    description: 'Returns a live content item of the signed-in store. Unknown, deleted or other-store items answer 404.',
    auth: 'merchant',
    success: { status: 200, description: 'Content item', body: ContentItem },
    errors: [401, 404],
  },
  {
    method: 'post',
    path: '/v1/content/:id/duplicate',
    tag: 'Content',
    summary: 'Duplicate a content item',
    description: 'Copies any non-deleted item into a fresh Draft with a title ending in literal " (copy)" within 80 characters. Copies the saved CTA, product link and ordered live slides with fresh IDs and shared media assets, including pending/failed media and hidden/deleted products. Resets auto-publication, publication and archive/reactivation metadata; copies no placements or schedule. Emits one content.item.created atomically. Unknown, malformed, deleted or other-store sources answer 404.',
    auth: 'merchant',
    success: { status: 201, description: 'Duplicated draft content item', body: ContentItem },
    errors: [401, 403, 404],
  },
  {
    method: 'post',
    path: '/v1/content/:id/retry',
    tag: 'Content',
    summary: 'Retry failed processing',
    description: 'Requeues processing_failed live slides and moves a failed item to processing. Returns 409 invalid-transition if the item is not failed or has no retryable slides.',
    auth: 'merchant',
    success: { status: 200, description: 'Processing content item', body: ContentItem },
    errors: [401, 403, 404, 409],
  },
  {
    method: 'post',
    path: '/v1/content/:id/publish',
    tag: 'Content',
    summary: 'Publish a content item now',
    description: `Publishes a Draft under its item lock. Requires a Story (Reels are not delivered in the pilot), a saved Home placement and all attached media to be processed. Refuses atomically with 422 ${CONTENT_UNSUPPORTED_FORMAT} (code unsupported_format), no-placement (code no_placement) or content-media-not-ready (code media_not_ready). Unsupported placement types and targets are rejected by create/edit. Sets first_published_at once and emits content.item.published in the same transaction.`,
    auth: 'merchant',
    success: { status: 200, description: 'Published content item', body: ContentItem },
    errors: [401, 403, 404, 409, 422],
  },
  {
    method: 'post',
    path: '/v1/content/:id/archive',
    tag: 'Content',
    summary: 'Archive a content item',
    description: `Moves any non-processing, non-archived item to \`archived\`, recording \`archived_from\` so \`undo-archive\` can return it. Disallowed transitions answer 409 with problem \`type\` \`${CONTENT_INVALID_TRANSITION}\`.`,
    auth: 'merchant',
    success: { status: 200, description: 'Archived content item', body: ContentItem },
    errors: [401, 403, 404, 409],
  },
  {
    method: 'post',
    path: '/v1/content/:id/undo-archive',
    tag: 'Content',
    summary: 'Undo archive on a content item',
    description: `Returns an \`archived\` item to the status it was archived from (\`archived_from\`). Disallowed transitions answer 409 with problem \`type\` \`${CONTENT_INVALID_TRANSITION}\`. Returning to Published or Scheduled requires a Story, a saved Home placement and processed media; admission failures answer 422 with type \`${CONTENT_UNSUPPORTED_FORMAT}\` (code unsupported_format), no-placement (code no_placement) or content-media-not-ready (code media_not_ready), without changing the item or emitting an event.`,
    auth: 'merchant',
    success: { status: 200, description: 'Unarchived content item', body: ContentItem },
    errors: [401, 403, 404, 409, 422],
  },
  {
    method: 'post',
    path: '/v1/content/:id/restore',
    tag: 'Content',
    summary: 'Restore an archived content item to draft',
    description: `Moves an \`archived\` item to \`draft\`. Disallowed transitions answer 409 with problem \`type\` \`${CONTENT_INVALID_TRANSITION}\`.`,
    auth: 'merchant',
    success: { status: 200, description: 'Restored draft content item', body: ContentItem },
    errors: [401, 403, 404, 409],
  },
  {
    method: 'delete',
    path: '/v1/content/:id',
    tag: 'Content',
    summary: 'Delete a content item',
    description: 'Soft-deletes (`deleted_at` tombstone) any live content item of the store and emits `content.item.deleted`. Subsequent reads or deletes answer 404.',
    auth: 'merchant',
    success: { status: 204, description: 'Deleted' },
    errors: [401, 403, 404],
  },

  {
    method: 'post',
    path: '/v1/media/uploads',
    tag: 'Media',
    summary: 'Get an upload URL',
    description: `A pre-signed PUT URL for one file, valid 15 minutes, under the store's own prefix and addressed by the file's SHA-256. Images: ${MEDIA_LIMITS.image.content_types.join(', ')} up to ${MEDIA_LIMITS.image.max_bytes / MB} MB; videos: ${MEDIA_LIMITS.video.content_types.join(', ')} up to ${MEDIA_LIMITS.video.max_bytes / MB} MB. Another type (SVG included) answers 422 with problem \`type\` \`${MEDIA_TYPE_NOT_ALLOWED}\`; a larger file 422 \`${MEDIA_TOO_LARGE}\`. Too many URLs for the store in 10 minutes answers 429 \`${MEDIA_UPLOAD_RATE_LIMITED}\` with a \`Retry-After\` header (seconds). Then PUT the file with the returned headers and call \`complete\`. Cookie sessions need \`x-csrf-token\`.`,
    auth: 'merchant',
    body: MediaUploadRequest,
    success: { status: 201, description: 'Upload URL', body: MediaUploadGrant },
    errors: [400, 401, 403, 422, 429],
  },
  {
    method: 'post',
    path: '/v1/media/imports',
    tag: 'Media',
    summary: 'Import from a link',
    description: `Records an \`importing\` asset for the file at \`url\`. The worker fetches it (never the API; the link is never served or hotlinked), checking every address the host resolves to and every redirect (at most 3) against private, loopback, link-local and metadata ranges, within the kind's size limit and a 2 minute timeout. The file then gets the same inspection as an upload. The outcome shows on \`GET /v1/media/{id}\`, e.g. \`failed\` with \`fetch_blocked\`, \`fetch_too_large\`, \`fetch_failed\`, \`type_not_allowed\` or \`type_mismatch\`. A link that is not http(s) on port 80/443, has user info, is longer than ${MEDIA_IMPORT_URL_MAX} characters, or whose host is a blocked IP address answers 422 with problem \`type\` \`${MEDIA_URL_NOT_ALLOWED}\`. Imports count toward the upload throttle (429 \`${MEDIA_UPLOAD_RATE_LIMITED}\` with \`Retry-After\`). Cookie sessions need \`x-csrf-token\`.`,
    auth: 'merchant',
    body: MediaImportRequest,
    success: { status: 201, description: 'The importing asset', body: MediaAsset },
    errors: [400, 401, 403, 422, 429],
  },
  {
    method: 'post',
    path: '/v1/media/uploads/:upload_id/complete',
    tag: 'Media',
    summary: 'Complete an upload',
    description: `Records the uploaded file as an \`uploaded\` asset and queues its inspection (hash check, type sniffing, metadata stripping, malware scan). Repeating the call returns the same asset. Not uploaded yet: 409 \`${MEDIA_UPLOAD_MISSING}\`; URL expired without an upload: 410 \`${MEDIA_UPLOAD_EXPIRED}\`; stored size differs from the declared one: 422 \`${MEDIA_TOO_LARGE}\` (the object is deleted). Unknown or other-store uploads answer 404.`,
    auth: 'merchant',
    success: { status: 200, description: 'The asset', body: MediaAsset },
    errors: [401, 403, 404, 409, 410, 422],
  },
  {
    method: 'get',
    path: '/v1/media/:id',
    tag: 'Media',
    summary: 'Get a media asset',
    description: 'Returns a media asset of the signed-in store and its inspection/processing status (`poster_url` is set once `processed`). Unknown or other-store assets answer 404.',
    auth: 'merchant',
    success: { status: 200, description: 'Media asset', body: MediaAsset },
    errors: [401, 404],
  },
  {
    method: 'get',
    path: '/v1/media/:id/poster',
    tag: 'Media',
    summary: 'Stream a processed media asset poster',
    description: 'Streams the `poster` rendition (`image/webp`, `720x1280`) for a processed video or the `web` rendition (`image/webp`) for a processed image of the signed-in store, with `Cache-Control: private, max-age=31536000, immutable`. Unknown, other-store or unready assets answer 404.',
    auth: 'merchant',
    success: { status: 200, description: 'WebP poster or image rendition bytes' },
    errors: [401, 404],
  },

  { method: 'post', path: '/v1/admin/sign-in', tag: 'Admin', summary: 'Slips Admin sign-in (not available yet)', description: 'Placeholder: always 403 until the admin identity provider is chosen.', auth: 'public', success: { status: 200, description: 'Signed in' }, errors: [403] },
  { method: 'get', path: '/v1/admin/session', tag: 'Admin', summary: 'Slips Admin session (not available yet)', auth: 'admin', success: { status: 200, description: 'Admin session' }, errors: [403] },
];

const TAGS = [
  { name: 'Salla install', description: 'How a store gets connected: the merchant installs Slips from the Salla App Store (or opens `install`), approves, and lands on the dashboard signed in. Salla then sends webhooks; on install the worker imports the product catalog.' },
  { name: 'Session', description: 'The two ways a merchant is signed in: the embedded bearer (dashboard inside Salla) and the direct-link cookie (dashboard opened on its own).' },
  { name: 'Password sign-in', description: 'Direct-link sign-in with email and password, set up from the invite sent on install.' },
  { name: 'Password reset & setup', description: 'Code-based flow shared by "forgot password" (purpose `reset`) and the first password of a new owner (purpose `setup`): request or receive a code → `verify-otp` → `reset-password` or `set-password`.' },
  { name: 'Catalog', description: "The store's products synced from Salla: listing, categories and the sync status." },
  { name: 'Content', description: 'Stories and Reels created by the merchant and their status lifecycle.' },
  { name: 'Media', description: 'Direct-to-storage uploads of images and videos and the inspection status of each asset.' },
  { name: 'Ops', description: 'Health and metrics for operations.' },
  { name: 'Admin', description: 'Internal Slips Admin (not available yet).' },
];

const INTRO = `The HTTP API behind the Slips dashboard. All paths are versioned under \`/v1\`.

## Signing in

| Where the dashboard runs | How | Then send |
|---|---|---|
| Inside Salla (iframe) | \`POST /v1/session/embedded\` with the Salla host token | \`Authorization: Bearer <access_token>\` |
| On its own, via Salla | Open \`GET /v1/integrations/salla/install\` → Salla consent → callback sets the cookie | the \`slips_session\` cookie (automatic) |
| On its own, with a password | \`POST /v1/auth/login\` (then \`login/select\` if several stores) | the \`slips_session\` cookie (automatic) |

Cookie sessions must send \`x-csrf-token\` (from \`GET /v1/session\`) on every POST. **Trying it here:** sign in to the dashboard in this browser first; the cookie is sent with "Try it out". For POSTs, paste the CSRF token into the header field.

## Conventions

- **Money:** integer minor units plus an ISO 4217 \`currency\` (SAR 120.50 → \`12050\`, KWD 1.250 → \`1250\`). Prices carry \`tax_inclusive\`.
- **Pagination:** \`page\` (1-based) and \`page_size\` in the query; responses return \`items\`, \`total\`, \`page\`, \`page_size\`.
- **Versioning:** responses carry \`v: 1\`; fields are only ever added within v1.
- **Times:** ISO 8601 UTC.

## Errors

Every error is \`application/problem+json\` (see the \`Problem\` model) with a stable \`code\`:

- Session: ${SESSION_PROBLEM_CODES.map((c) => `\`${c}\``).join(', ')}
- Password sign-in: ${AUTH_PROBLEM_CODES.map((c) => `\`${c}\``).join(', ')}
- Queries: \`invalid_query\`
- Catalog: \`sync_rate_limited\` (problem \`type\` \`sync-rate-limited\`, with a \`Retry-After\` header in seconds)
- Content: \`invalid_body\`, \`content_not_found\`, \`invalid_transition\` (409, problem \`type\` \`${CONTENT_INVALID_TRANSITION}\`), \`cta_url_not_store_domain\` (422, problem \`type\` \`${CONTENT_CTA_URL_NOT_STORE_DOMAIN}\`), \`product_not_linkable\` (422, problem \`type\` \`${CONTENT_PRODUCT_NOT_LINKABLE}\`), \`media_not_attachable\` (422, problem \`type\` \`${MEDIA_NOT_ATTACHABLE}\`), \`slide_alt_text_required\` (422, problem \`type\` \`${CONTENT_SLIDE_ALT_REQUIRED}\`)
- Media: \`invalid_body\`, \`media_url_not_allowed\` (422, \`${MEDIA_URL_NOT_ALLOWED}\`), \`media_type_not_allowed\` (422, \`${MEDIA_TYPE_NOT_ALLOWED}\`), \`media_too_large\` (422, \`${MEDIA_TOO_LARGE}\`), \`media_upload_rate_limited\` (429, \`${MEDIA_UPLOAD_RATE_LIMITED}\`, with \`Retry-After\`), \`media_upload_missing\` (409, \`${MEDIA_UPLOAD_MISSING}\`), \`media_upload_expired\` (410, \`${MEDIA_UPLOAD_EXPIRED}\`), \`media_upload_not_found\`, \`media_not_found\``;

const STATUS_TEXT: Record<number, string> = {
  400: 'Invalid request (`code` says which)',
  401: 'Not signed in, session expired, or wrong credentials',
  403: 'Forbidden: missing/invalid CSRF token, store not installed, or admin only',
  404: 'Not found',
  409: 'Conflict (`type` `invalid-transition` when a status change or edit is not allowed, `media-upload-missing` before the file is uploaded)',
  410: 'Gone (`type` `media-upload-expired`: the upload URL expired unused)',
  422: 'Unprocessable (`type` says which rule, e.g. `cta-url-not-store-domain`)',
  429: 'Too many attempts; try again later (after `Retry-After` seconds when the header is sent)',
  503: 'A dependency (database or Salla) is unavailable',
};

function parameters(q: QueryDoc) {
  const json = tidy(z.toJSONSchema(q.schema, { target: 'openapi-3.0', io: 'input' })) as { properties?: Record<string, object>; required?: string[] };
  return Object.entries(json.properties ?? {}).map(([name, schema]) => {
    const description = q.descriptions[name];
    if (!description) throw new Error(`openapi: query parameter ${name} has no description`);
    return { name, in: 'query', required: json.required?.includes(name) ?? false, description, schema, ...(q.examples?.[name] !== undefined ? { example: q.examples[name] } : {}) };
  });
}

const security = (auth: Auth) => (auth === 'merchant' ? [{ bearerAuth: [] }, { cookieAuth: [] }] : auth === 'admin' ? [{ adminAuth: [] }] : []);

export function buildOpenApi(serverUrl: string, version = '0.0.0') {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of ROUTES) {
    const ok = r.success;
    const responses: Record<string, unknown> = {
      [ok.status]: {
        description: ok.description,
        ...(ok.headers ? { headers: Object.fromEntries(Object.entries(ok.headers).map(([h, d]) => [h, { description: d, schema: { type: 'string' } }])) } : {}),
        ...(ok.body
          ? { content: { 'application/json': { schema: refFor(ok.body, outputs), ...(ok.example ? { example: ok.example } : {}) } } }
          : ok.contentType
            ? { content: { [ok.contentType]: { schema: { type: 'string', ...(ok.contentType === 'application/octet-stream' ? { format: 'binary' } : {}) } } } }
            : {}),
      },
    };
    for (const status of r.errors ?? []) responses[status] = { $ref: `#/components/responses/E${status}` };
    const pathParameters = [...r.path.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map((match) => ({
      name: match[1]!, in: 'path', required: true, schema: { type: 'string' },
    }));
    const operationParameters = [...pathParameters, ...(r.query ? parameters(r.query) : [])];
    const path = r.path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}');
    (paths[path] ??= {})[r.method] = {
      tags: [r.tag],
      summary: r.summary,
      ...(r.description ? { description: r.description } : {}),
      operationId: `${r.method}${r.path.replace(/[^a-zA-Z0-9]+(\w)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : ''))}`,
      security: security(r.auth),
      ...(operationParameters.length ? { parameters: operationParameters } : {}),
      ...(r.body ? { requestBody: { required: true, content: { 'application/json': { schema: refFor(r.body, inputs) } } } } : {}),
      responses,
    };
  }
  const statuses = [...new Set(ROUTES.flatMap((r) => r.errors ?? []))].sort();
  return {
    openapi: '3.0.3',
    info: { title: 'Slips API', version, description: INTRO },
    servers: [{ url: serverUrl }],
    tags: TAGS,
    paths,
    components: {
      schemas: { ...exportModels(inputs, 'input'), ...exportModels(outputs, 'output') },
      responses: Object.fromEntries(
        statuses.map((s) => [`E${s}`, { description: STATUS_TEXT[s] ?? 'Error', content: { 'application/problem+json': { schema: ref('Problem') } } }]),
      ),
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', description: 'Embedded session bearer from `POST /v1/session/embedded`.' },
        cookieAuth: { type: 'apiKey', in: 'cookie', name: 'slips_session', description: 'Direct-link session cookie. POSTs also need `x-csrf-token`.' },
        adminAuth: { type: 'http', scheme: 'bearer', description: 'Slips Admin (not available yet).' },
      },
    },
  };
}

const SWAGGER_UI = 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.34.1';

/** Swagger UI page that loads the spec from `/v1/openapi.json`. Cookies ride along, so "Try it out" works when signed in. */
export function docsPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Slips API docs</title>
  <link rel="stylesheet" href="${SWAGGER_UI}/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="${SWAGGER_UI}/swagger-ui-bundle.js" crossorigin></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: '/v1/openapi.json',
      dom_id: '#swagger-ui',
      withCredentials: true,
      persistAuthorization: true,
      displayOperationId: false,
      defaultModelsExpandDepth: 1,
      defaultModelExpandDepth: 3,
      docExpansion: 'list',
      filter: true,
      tryItOutEnabled: true,
    });
  </script>
</body>
</html>`;
}
