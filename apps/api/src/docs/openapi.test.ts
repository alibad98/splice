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

type Json = Record<string, unknown>;
const doc = buildOpenApi('http://localhost:3001', '1.2.3') as unknown as Json & { paths: Record<string, Record<string, Json>>; components: { schemas: Record<string, Json>; responses: Json } };
const op = (path: string, method: string) => doc.paths[path]![method] as Json & { parameters?: Json[]; responses: Record<string, Json>; requestBody?: Json; security: unknown[] };
const jsonSchema = (response: Json) => ((response.content as Json)['application/json'] as Json).schema as Json;

function walk(node: unknown, visit: (key: string, value: unknown, parent: Json) => void): void {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, visit));
  if (!node || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    visit(k, v, node as Json);
    walk(v, visit);
  }
}

describe('API docs', () => {
  it('documents exactly the routes the controllers declare', () => {
    expect(ROUTES.map((r) => `${r.method} ${r.path}`).sort()).toEqual(declaredRoutes());
  });

  it('is OpenAPI 3.0 with named models: every JSON body and error is a $ref', () => {
    expect(doc.openapi).toBe('3.0.3');
    expect(Object.keys(doc.components.schemas)).toEqual(
      expect.arrayContaining(['Problem', 'SessionInfo', 'ConnectionStatus', 'SignInResult', 'Product', 'ProductPage', 'CategoryList', 'CatalogSyncStatus', 'LoginRequest', 'VerifyOtpRequest']),
    );
    for (const [path, ops] of Object.entries(doc.paths)) {
      for (const [method, o] of Object.entries(ops) as Array<[string, Json & { responses: Record<string, Json>; requestBody?: Json }]>) {
        for (const [status, response] of Object.entries(o.responses)) {
          if (Number(status) >= 400) expect(response.$ref, `${method} ${path} ${status}`).toMatch(/^#\/components\/responses\/E\d+$/);
          else if (response.content && (response.content as Json)['application/json']) expect(jsonSchema(response).$ref, `${method} ${path}`).toMatch(/^#\/components\/schemas\//);
        }
        if (o.requestBody) expect(jsonSchema(o.requestBody).$ref, `${method} ${path} body`).toMatch(/^#\/components\/schemas\//);
      }
    }
  });

  it('nests models by reference (ProductPage -> Product, SignInResult -> SessionInfo -> ConnectionStatus)', () => {
    const s = doc.components.schemas;
    expect(JSON.stringify(s.ProductPage)).toContain('#/components/schemas/Product"');
    expect(JSON.stringify(s.SignInResult)).toContain('#/components/schemas/SessionInfo');
    expect(JSON.stringify(s.SessionInfo)).toContain('#/components/schemas/ConnectionStatus');
  });

  it('has no generator noise and every $ref resolves', () => {
    walk(doc, (key, value, parent) => {
      expect(['$schema', '$id']).not.toContain(key);
      if (key === 'maximum') expect(value).not.toBe(Number.MAX_SAFE_INTEGER);
      if (key === 'pattern') expect(parent.format).not.toBe('uuid');
      if (key === '$ref') {
        const [, kind, name] = /^#\/components\/(schemas|responses)\/(.+)$/.exec(String(value)) ?? [];
        expect(kind && (doc.components[kind as 'schemas' | 'responses'] as Json)[name!], String(value)).toBeTruthy();
      }
    });
  });

  it('documents the products query from the contract: search, category, sort, page, with descriptions', () => {
    const products = op('/v1/products', 'get');
    expect(products.parameters!.map((p) => p.name).sort()).toEqual(['category', 'page', 'q', 'sort']);
    for (const p of products.parameters!) expect(p.description, String(p.name)).toBeTruthy();
    expect(products.parameters!.find((p) => p.name === 'page')!.schema).toMatchObject({ type: 'integer', minimum: 1, default: 1 });
    expect(products.parameters!.find((p) => p.name === 'sort')!.schema).toMatchObject({ enum: ['name', '-name', 'price', '-price'] });
    expect(products.security).toEqual([{ bearerAuth: [] }, { cookieAuth: [] }]);
    expect(((products.responses['200']!.content as Json)['application/json'] as Json).example).toBeTruthy();
  });

  it('documents the manual sync: 202 with the sync status, 401/403/429, and the problem type slug', () => {
    const sync = op('/v1/catalog/sync', 'post');
    expect(jsonSchema(sync.responses['202']!).$ref).toBe('#/components/schemas/CatalogSyncStatus');
    expect(Object.keys(sync.responses).sort()).toEqual(['202', '401', '403', '429']);
    expect(String(sync.description)).toContain('sync-rate-limited');
    expect(String(sync.description)).toContain('Retry-After');
    expect(JSON.stringify(doc.components.schemas.CatalogSyncStatus)).toContain('queued');
    expect(JSON.stringify(doc.components.schemas.Problem)).toContain('sync-rate-limited');
  });

  it('describes the flows: intro sections, tags with descriptions, and a summary on every operation', () => {
    const info = doc.info as Json;
    for (const heading of ['## Signing in', '## Conventions', '## Errors']) expect(info.description).toContain(heading);
    const tags = doc.tags as Array<{ name: string; description: string }>;
    const used = new Set(ROUTES.map((r) => r.tag));
    expect(tags.map((t) => t.name).sort()).toEqual([...used].sort());
    for (const t of tags) expect(t.description).toBeTruthy();
    for (const ops of Object.values(doc.paths)) for (const o of Object.values(ops)) expect((o as Json).summary).toBeTruthy();
  });

  it('serves a Swagger UI page pointed at the spec', () => {
    expect(docsPage()).toContain("url: '/v1/openapi.json'");
  });
});
