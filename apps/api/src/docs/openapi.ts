import {
  AUTH_PROBLEM_CODES,
  CatalogSyncStatus,
  CategoryListResponse,
  ConnectionStatus,
  EmbeddedSession,
  ForgotPasswordInput,
  HealthResponse,
  LoginInput,
  OtpPurpose,
  PRODUCT_PAGE_SIZE,
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
  type: z.string().describe('Always `about:blank` today.'),
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
  [ProductListResponse, 'ProductPage', `One page of products: \`items\` (at most ${PRODUCT_PAGE_SIZE}), \`total\` matching products, \`page\` (1-based) and \`page_size\`.`],
  [CategoryListResponse, 'CategoryList', "The store's categories for the Products filter."],
  [CatalogSyncState, 'CatalogSyncStatus', 'Latest catalog sync run. `never` until the first one starts.'],
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

type Method = 'get' | 'post';
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
      linked_content_count: 0,
      attributed_orders: null,
    },
  ],
};

export const ROUTES: RouteDoc[] = [
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
    description: `Products of the signed-in store that are visible in Salla. Pages hold ${PRODUCT_PAGE_SIZE} items; use \`total\` and \`page_size\` to compute the page count. A page past the end returns empty \`items\` with the real \`total\`. Invalid parameters answer 400 \`invalid_query\`.`,
    auth: 'merchant',
    query: {
      schema: ProductListQuery,
      descriptions: {
        q: `Search product names (case-insensitive substring, Arabic or English; \`%\` and \`_\` match literally). Max ${PRODUCT_SEARCH_MAX} characters.`,
        category: 'Only products in this category. Use an `external_id` from `GET /v1/products/categories`.',
        sort: '`name` (default) or `price` (the effective price: sale price when set). Prefix with `-` for descending.',
        page: '1-based page number.',
      },
      examples: { q: 'عباية' },
    },
    success: { status: 200, description: 'One page of products', body: ProductListResponse, example: productExample },
    errors: [400, 401],
  },
  { method: 'get', path: '/v1/products/categories', tag: 'Catalog', summary: 'List categories', description: 'For the category filter, sorted by name.', auth: 'merchant', success: { status: 200, description: 'Categories', body: CategoryListResponse }, errors: [401] },
  { method: 'get', path: '/v1/catalog/sync', tag: 'Catalog', summary: 'Catalog sync status', description: 'Poll while `running` (or `never`) to know when the first import has finished; `failed` carries a `reason`.', auth: 'merchant', success: { status: 200, description: 'Sync status', body: CatalogSyncStatus }, errors: [401] },

  { method: 'post', path: '/v1/admin/sign-in', tag: 'Admin', summary: 'Slips Admin sign-in (not available yet)', description: 'Placeholder: always 403 until the admin identity provider is chosen.', auth: 'public', success: { status: 200, description: 'Signed in' }, errors: [403] },
  { method: 'get', path: '/v1/admin/session', tag: 'Admin', summary: 'Slips Admin session (not available yet)', auth: 'admin', success: { status: 200, description: 'Admin session' }, errors: [403] },
];

const TAGS = [
  { name: 'Salla install', description: 'How a store gets connected: the merchant installs Slips from the Salla App Store (or opens `install`), approves, and lands on the dashboard signed in. Salla then sends webhooks; on install the worker imports the product catalog.' },
  { name: 'Session', description: 'The two ways a merchant is signed in: the embedded bearer (dashboard inside Salla) and the direct-link cookie (dashboard opened on its own).' },
  { name: 'Password sign-in', description: 'Direct-link sign-in with email and password, set up from the invite sent on install.' },
  { name: 'Password reset & setup', description: 'Code-based flow shared by "forgot password" (purpose `reset`) and the first password of a new owner (purpose `setup`): request or receive a code → `verify-otp` → `reset-password` or `set-password`.' },
  { name: 'Catalog', description: "The store's products synced from Salla: listing, categories and the sync status." },
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
- **Pagination:** \`page\` (1-based) in the query; responses return \`items\`, \`total\`, \`page\`, \`page_size\`.
- **Versioning:** responses carry \`v: 1\`; fields are only ever added within v1.
- **Times:** ISO 8601 UTC.

## Errors

Every error is \`application/problem+json\` (see the \`Problem\` model) with a stable \`code\`:

- Session: ${SESSION_PROBLEM_CODES.map((c) => `\`${c}\``).join(', ')}
- Password sign-in: ${AUTH_PROBLEM_CODES.map((c) => `\`${c}\``).join(', ')}
- Queries: \`invalid_query\``;

const STATUS_TEXT: Record<number, string> = {
  400: 'Invalid request (`code` says which)',
  401: 'Not signed in, session expired, or wrong credentials',
  403: 'Forbidden: missing/invalid CSRF token, store not installed, or admin only',
  404: 'Not found',
  429: 'Too many attempts; try again later',
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
            ? { content: { [ok.contentType]: { schema: { type: 'string' } } } }
            : {}),
      },
    };
    for (const status of r.errors ?? []) responses[status] = { $ref: `#/components/responses/E${status}` };
    (paths[r.path] ??= {})[r.method] = {
      tags: [r.tag],
      summary: r.summary,
      ...(r.description ? { description: r.description } : {}),
      operationId: `${r.method}${r.path.replace(/[^a-zA-Z0-9]+(\w)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : ''))}`,
      security: security(r.auth),
      ...(r.query ? { parameters: parameters(r.query) } : {}),
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
