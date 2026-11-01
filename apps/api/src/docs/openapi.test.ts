import 'reflect-metadata';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { RequestMethod } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { MetricsController } from '../adapters/telemetry/metrics.module.js';
import { AdminController } from '../modules/admin/admin.controller.js';
import { AuthController } from '../modules/auth/auth.controller.js';
import { CredentialsController } from '../modules/auth/credentials.controller.js';
import { CatalogController } from '../modules/catalog/catalog.controller.js';
import { HealthController } from '../modules/health/health.controller.js';
import { IntegrationController } from '../modules/integration/integration.controller.js';
import { WebhookController } from '../modules/integration/webhook.controller.js';
import { buildOpenApi, docsPage, ROUTES } from './openapi.js';

const CONTROLLERS = [MetricsController, AdminController, AuthController, CredentialsController, CatalogController, HealthController, IntegrationController, WebhookController];

const join = (...parts: string[]) => `/${parts.flatMap((p) => p.split('/')).filter(Boolean).join('/')}`;
const first = (v: unknown): string => (Array.isArray(v) ? String(v[0]) : String(v ?? ''));

function declaredRoutes(): string[] {
  const out: string[] = [];
  for (const ctrl of CONTROLLERS) {
    const base = first(Reflect.getMetadata(PATH_METADATA, ctrl));
    for (const name of Object.getOwnPropertyNames(ctrl.prototype)) {
      const handler = (ctrl.prototype as unknown as Record<string, unknown>)[name];
      if (name === 'constructor' || typeof handler !== 'function') continue;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
      if (method === undefined) continue;
      out.push(`${RequestMethod[method].toLowerCase()} ${join(base, first(Reflect.getMetadata(PATH_METADATA, handler)))}`);
    }
  }
  return out.sort();
}

describe('API docs', () => {
  it('documents exactly the routes the controllers declare', () => {
    expect(ROUTES.map((r) => `${r.method} ${r.path}`).sort()).toEqual(declaredRoutes());
  });

  it('builds an OpenAPI 3.1 document with contract schemas, query parameters and auth', () => {
    const doc = buildOpenApi('http://localhost:3001', '1.2.3');
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.version).toBe('1.2.3');
    const products = doc.paths['/v1/products']!.get as { parameters: Array<{ name: string }>; security: unknown[]; responses: Record<string, { content?: Record<string, { schema: { properties?: object } }> }> };
    expect(products.parameters.map((p) => p.name).sort()).toEqual(['category', 'page', 'q', 'sort']);
    expect(products.security).toEqual([{ bearerAuth: [] }, { cookieAuth: [] }]);
    expect(Object.keys(products.responses['200']!.content!['application/json']!.schema.properties ?? {})).toEqual(expect.arrayContaining(['items', 'total', 'page', 'page_size']));
    const login = doc.paths['/v1/auth/login']!.post as { requestBody: { content: Record<string, { schema: { required?: string[] } }> }; security: unknown[] };
    expect(login.security).toEqual([]);
    expect(login.requestBody.content['application/json']!.schema.required).toEqual(expect.arrayContaining(['email', 'password']));
  });

  it('serves a Swagger UI page pointed at the spec', () => {
    expect(docsPage()).toContain("url: '/v1/openapi.json'");
  });
});
