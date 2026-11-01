import {
  CatalogSyncStatus,
  CategoryListResponse,
  EmbeddedSession,
  ForgotPasswordInput,
  HealthResponse,
  LoginInput,
  ProductListQuery,
  ProductListResponse,
  ResendOtpInput,
  ResetPasswordInput,
  SelectStoreInput,
  SessionInfo,
  SetPasswordInput,
  SignInResponse,
  VerifyOtpInput,
  VerifyOtpResponse,
} from '@slips/contracts';
import { z } from 'zod';

/**
 * OpenAPI 3.1 description of the HTTP API, generated from the same Zod contracts the API validates with, so the
 * schemas cannot drift from the code. Every route a controller declares must appear in ROUTES (openapi.test.ts).
 */

type Method = 'get' | 'post';
type Auth = 'public' | 'merchant' | 'admin';

export interface RouteDoc {
  method: Method;
  path: string;
  tag: string;
  summary: string;
  auth: Auth;
  query?: z.ZodObject;
  body?: z.ZodType;
  /** Success status and its JSON body (omit the body for no content or non-JSON answers). */
  success: { status: number; description: string; body?: z.ZodType; contentType?: string };
  errors?: number[];
}

const Ok = z.object({ ok: z.literal(true), message: z.string() });
const EmbeddedBody = z.object({ token: z.string().min(1).max(4096).describe('Token from the Salla embedded SDK `getToken()`') });

export const ROUTES: RouteDoc[] = [
  { method: 'get', path: '/v1/health', tag: 'Ops', summary: 'Liveness and database check', auth: 'public', success: { status: 200, description: 'Healthy', body: HealthResponse }, errors: [503] },
  { method: 'get', path: '/metrics', tag: 'Ops', summary: 'Prometheus metrics (needs the metrics token)', auth: 'public', success: { status: 200, description: 'Prometheus text format', contentType: 'text/plain' }, errors: [401] },

  { method: 'get', path: '/v1/integrations/salla/install', tag: 'Salla integration', summary: 'Start install / sign-in with Salla (302 to Salla consent)', auth: 'public', success: { status: 302, description: 'Redirect to Salla OAuth consent' }, errors: [503] },
  { method: 'get', path: '/v1/integrations/salla/mock-consent', tag: 'Salla integration', summary: 'Dev-only consent simulator (404 unless the dev platform is active)', auth: 'public', success: { status: 200, description: 'HTML form', contentType: 'text/html' }, errors: [400, 404] },
  { method: 'get', path: '/v1/integrations/salla/callback', tag: 'Salla integration', summary: 'OAuth redirect target; signs the merchant in and redirects to the dashboard', auth: 'public', success: { status: 302, description: 'Redirect to the dashboard (`?connected=1` or `?install_error=`)' } },
  { method: 'post', path: '/v1/webhooks/salla', tag: 'Salla integration', summary: 'Salla webhooks (signature-verified, raw body)', auth: 'public', success: { status: 200, description: 'Accepted' }, errors: [401] },

  { method: 'post', path: '/v1/session/embedded', tag: 'Session', summary: 'Embedded sign-in: trade the Salla host token for a short-lived bearer', auth: 'public', body: EmbeddedBody, success: { status: 200, description: 'Bearer for the dashboard (kept in memory)', body: EmbeddedSession }, errors: [400, 401, 403, 503] },
  { method: 'get', path: '/v1/session', tag: 'Session', summary: 'The signed-in merchant, connection status and CSRF token (cookie sessions)', auth: 'merchant', success: { status: 200, description: 'Session', body: SessionInfo }, errors: [401] },
  { method: 'post', path: '/v1/session/sign-out', tag: 'Session', summary: 'End the session', auth: 'merchant', success: { status: 204, description: 'Signed out' }, errors: [401, 403] },

  { method: 'post', path: '/v1/auth/login', tag: 'Password sign-in', summary: 'Email + password sign-in (direct link)', auth: 'public', body: LoginInput, success: { status: 200, description: 'Signed in, or pick a store first', body: SignInResponse }, errors: [400, 401, 429] },
  { method: 'post', path: '/v1/auth/login/select', tag: 'Password sign-in', summary: 'Pick the store to open after a multi-store login', auth: 'public', body: SelectStoreInput, success: { status: 200, description: 'Signed in', body: SignInResponse }, errors: [400, 401] },
  { method: 'post', path: '/v1/auth/forgot-password', tag: 'Password sign-in', summary: 'Email a password-reset code', auth: 'public', body: ForgotPasswordInput, success: { status: 200, description: 'Code sent if the email is known', body: Ok }, errors: [400, 429] },
  { method: 'post', path: '/v1/auth/verify-otp', tag: 'Password sign-in', summary: 'Check a 6-digit code; returns a reset or setup token', auth: 'public', body: VerifyOtpInput, success: { status: 200, description: 'Code accepted', body: VerifyOtpResponse }, errors: [400, 401, 429] },
  { method: 'post', path: '/v1/auth/reset-password', tag: 'Password sign-in', summary: 'Set a new password with a reset token', auth: 'public', body: ResetPasswordInput, success: { status: 200, description: 'Password changed', body: Ok }, errors: [400, 401] },
  { method: 'post', path: '/v1/auth/set-password', tag: 'Password sign-in', summary: "Set the owner's first password with a setup token, then sign in", auth: 'public', body: SetPasswordInput, success: { status: 200, description: 'Signed in', body: SignInResponse }, errors: [400, 401] },
  { method: 'post', path: '/v1/auth/resend-otp', tag: 'Password sign-in', summary: 'Send the code again', auth: 'public', body: ResendOtpInput, success: { status: 200, description: 'Code sent if allowed', body: Ok }, errors: [400, 429] },

  { method: 'get', path: '/v1/products', tag: 'Catalog', summary: 'Visible products: search, category filter, sort, pages of 50', auth: 'merchant', query: ProductListQuery, success: { status: 200, description: 'One page of products', body: ProductListResponse }, errors: [400, 401] },
  { method: 'get', path: '/v1/products/categories', tag: 'Catalog', summary: "The store's categories for the filter", auth: 'merchant', success: { status: 200, description: 'Categories by name', body: CategoryListResponse }, errors: [401] },
  { method: 'get', path: '/v1/catalog/sync', tag: 'Catalog', summary: 'Latest catalog sync run (`never` before the first)', auth: 'merchant', success: { status: 200, description: 'Sync status', body: CatalogSyncStatus }, errors: [401] },

  { method: 'post', path: '/v1/admin/sign-in', tag: 'Admin', summary: 'Slips Admin sign-in (not available yet)', auth: 'public', success: { status: 200, description: 'Signed in' }, errors: [403] },
  { method: 'get', path: '/v1/admin/session', tag: 'Admin', summary: 'Slips Admin session', auth: 'admin', success: { status: 200, description: 'Admin session' }, errors: [403] },
];

const STATUS_TEXT: Record<number, string> = {
  400: 'Invalid request',
  401: 'Sign in required, session expired, or invalid credentials',
  403: 'Forbidden (CSRF, store not installed, or admin only)',
  404: 'Not found',
  429: 'Too many attempts',
  503: 'Dependency unavailable',
};

const Problem = z.object({
  type: z.string().describe('Always `about:blank` today'),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  code: z.string().optional().describe('Stable machine-readable reason, e.g. `invalid_query`, `session_expired`'),
});

const schema = (s: z.ZodType, io: 'input' | 'output') => z.toJSONSchema(s, { target: 'draft-2020-12', io, unrepresentable: 'any' });

function parameters(query: z.ZodObject) {
  const json = schema(query, 'input') as { properties?: Record<string, object>; required?: string[] };
  return Object.entries(json.properties ?? {}).map(([name, s]) => ({ name, in: 'query', required: json.required?.includes(name) ?? false, schema: s }));
}

const security = (auth: Auth) => (auth === 'merchant' ? [{ bearerAuth: [] }, { cookieAuth: [] }] : auth === 'admin' ? [{ adminAuth: [] }] : []);

export function buildOpenApi(serverUrl: string, version = '0.0.0') {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of ROUTES) {
    const responses: Record<string, unknown> = {
      [r.success.status]: {
        description: r.success.description,
        ...(r.success.body ? { content: { 'application/json': { schema: schema(r.success.body, 'output') } } } : r.success.contentType ? { content: { [r.success.contentType]: { schema: { type: 'string' } } } } : {}),
      },
    };
    for (const status of r.errors ?? []) responses[status] = { description: STATUS_TEXT[status] ?? 'Error', content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } } };
    (paths[r.path] ??= {})[r.method] = {
      tags: [r.tag],
      summary: r.summary,
      security: security(r.auth),
      ...(r.query ? { parameters: parameters(r.query) } : {}),
      ...(r.body ? { requestBody: { required: true, content: { 'application/json': { schema: schema(r.body, 'input') } } } } : {}),
      responses,
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Slips API',
      version,
      description:
        'Merchant routes accept either an embedded bearer (`Authorization: Bearer …` from `POST /v1/session/embedded`) or the direct-link `slips_session` cookie. Cookie sessions must send `x-csrf-token` (from `GET /v1/session`) on POST requests. Errors are RFC 9457 `application/problem+json` with a stable `code`.',
    },
    servers: [{ url: serverUrl }],
    paths,
    components: {
      schemas: { Problem: schema(Problem, 'output') },
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', description: 'Embedded session bearer' },
        cookieAuth: { type: 'apiKey', in: 'cookie', name: 'slips_session', description: 'Direct-link session cookie; POSTs also need `x-csrf-token`' },
        adminAuth: { type: 'http', scheme: 'bearer', description: 'Slips Admin (not available yet)' },
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
    window.ui = SwaggerUIBundle({ url: '/v1/openapi.json', dom_id: '#swagger-ui', withCredentials: true, persistAuthorization: true, tryItOutEnabled: true });
  </script>
</body>
</html>`;
}
