import 'reflect-metadata';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { RequestMethod } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { MetricsController } from '../adapters/telemetry/metrics.module.js';
import { AdminController } from '../modules/admin/admin.controller.js';
import { AuthController } from '../modules/auth/auth.controller.js';
import { CredentialsController } from '../modules/auth/credentials.controller.js';
import { CatalogController } from '../modules/catalog/catalog.controller.js';
import { ContentController } from '../modules/content/content.controller.js';
import { MediaController } from '../modules/media/media.controller.js';
import { PreviewController } from '../modules/publishing/preview.controller.js';
import { HealthController } from '../modules/health/health.controller.js';
import { IntegrationController } from '../modules/integration/integration.controller.js';
import { WebhookController } from '../modules/integration/webhook.controller.js';
import { buildOpenApi, docsPage, ROUTES } from './openapi.js';

const CONTROLLERS = [MetricsController, AdminController, AuthController, CredentialsController, CatalogController, ContentController, MediaController, PreviewController, HealthController, IntegrationController, WebhookController];

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
const op = (path: string, method: string) => doc.paths[path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}')]![method] as Json & { parameters?: Json[]; responses: Record<string, Json>; requestBody?: Json; security: unknown[] };
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
  it('uses OpenAPI path templates and declares every placeholder as a required path parameter', () => {
    expect(doc.paths['/v1/media/{id}/renditions/{profile}']).toBeDefined();
    for (const [path, operations] of Object.entries(doc.paths)) {
      expect(path).not.toContain(':');
      const names = [...path.matchAll(/\{([^}]+)\}/g)].map(match => match[1]);
      for (const operation of Object.values(operations)) {
        const pathParams = ((operation.parameters ?? []) as Json[]).filter(p => p.in === 'path');
        expect(pathParams.map(p => p.name)).toEqual(names);
        for (const parameter of pathParams) expect(parameter).toMatchObject({ required: true, schema: { type: 'string' } });
      }
    }
  });
  it('documents authenticated bodyless duplication returning a created ContentItem', () => {
    const duplicate = op('/v1/content/:id/duplicate', 'post');
    expect(duplicate.security).toEqual([{ bearerAuth: [] }, { cookieAuth: [] }]);
    expect(duplicate.requestBody).toBeUndefined();
    expect(jsonSchema(duplicate.responses['201']!).$ref).toBe('#/components/schemas/ContentItem');
    expect(Object.keys(duplicate.responses).sort()).toEqual(['201', '401', '403', '404']);
  });
    it('documents Undo Archive eligibility failures for live destinations', () => {
      const undo = op('/v1/content/:id/undo-archive', 'post');
      expect(Object.keys(undo.responses)).toContain('422');
      expect(String(undo.description)).toContain('no-placement');
      expect(String(undo.description)).toContain('content-media-not-ready');
    });
  it('documents private preview manifests and authenticated inspected media bytes', () => {
    const preview = op('/v1/preview/content/:id', 'get');
    expect(jsonSchema(preview.responses['200']!).$ref).toBe('#/components/schemas/StoreManifest');
    expect(JSON.stringify(doc.components.schemas.StoreManifest)).toContain('#/components/schemas/ManifestItem');
    expect(JSON.stringify(doc.components.schemas.ManifestItem)).toContain('#/components/schemas/ContentProduct');
    expect(JSON.stringify(doc.components.schemas.ManifestSlide)).toContain('#/components/schemas/ManifestRendition');
    for (const operation of [preview, op('/v1/media/:id/source', 'get'), op('/v1/media/:id/renditions/:profile', 'get')]) {
      expect(operation.security).toEqual([{ bearerAuth: [] }, { cookieAuth: [] }]);
      expect(Object.keys(operation.responses).sort()).toEqual(['200', '401', '404']);
      expect(JSON.stringify(operation.responses['200']!.headers)).toContain('private, no-store');
    }
    for (const path of ['/v1/media/:id/source', '/v1/media/:id/renditions/:profile']) {
      const content = op(path, 'get').responses['200']!.content as Json;
      expect((content['application/octet-stream'] as Json).schema).toEqual({ type: 'string', format: 'binary' });
    }
  });

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

  it('documents the products query from the contract: search, category, sort, page, page_size, with descriptions', () => {
    const products = op('/v1/products', 'get');
    expect(products.parameters!.map((p) => p.name).sort()).toEqual(['category', 'page', 'page_size', 'q', 'sort']);
    expect(products.parameters!.find((p) => p.name === 'page_size')!.schema).toMatchObject({ type: 'integer', default: 10 });
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

  it('documents the content list query and its ContentPage model (Story 3.2)', () => {
    const list = op('/v1/content', 'get');
    expect(list.parameters!.map((p) => p.name).sort()).toEqual(['page', 'page_size', 'q', 'sort', 'tab']);
    expect(list.parameters!.find((p) => p.name === 'tab')!.schema).toMatchObject({ enum: ['all', 'published', 'scheduled', 'drafts'], default: 'all' });
    expect(list.parameters!.find((p) => p.name === 'sort')!.schema).toMatchObject({ enum: ['-updated', 'updated', 'title', '-title'], default: '-updated' });
    expect(jsonSchema(list.responses['200']!).$ref).toBe('#/components/schemas/ContentPage');
    expect(JSON.stringify(doc.components.schemas.ContentPage)).toContain('#/components/schemas/ContentItem"');
  });

  it('documents the content edit route with its request model and 409/422 problems (Story 3.3)', () => {
    const editPath = Object.keys(doc.paths).find((p) => p.startsWith('/v1/content/') && doc.paths[p]!.patch)!;
    const edit = op(editPath, 'patch');
    expect(JSON.stringify(edit.requestBody)).toContain('#/components/schemas/ContentUpdateRequest');
    expect(Object.keys(edit.responses)).toEqual(expect.arrayContaining(['200', '400', '404', '409', '422']));
    expect(String(edit.description)).toContain('cta-url-not-store-domain');
    expect(Object.keys(op('/v1/content', 'post').responses)).toContain('422');
    expect(JSON.stringify(doc.components.schemas.ContentUpdateRequest)).toContain('cta_style');
  });

  it('documents product links: product_id on create/edit, the ContentProduct model and 422 product-not-linkable (Story 3.4)', () => {
    const editPath = Object.keys(doc.paths).find((p) => p.startsWith('/v1/content/') && doc.paths[p]!.patch)!;
    expect(String(op(editPath, 'patch').description)).toContain('product-not-linkable');
    expect(String(op('/v1/content', 'post').description)).toContain('product-not-linkable');
    expect(JSON.stringify(doc.components.schemas.ContentUpdateRequest)).toContain('product_id');
    expect(JSON.stringify(doc.components.schemas.ContentCreateRequest)).toContain('product_id');
    expect(JSON.stringify(doc.components.schemas.ContentItem)).toContain('#/components/schemas/ContentProduct"');
    expect(JSON.stringify(doc.components.schemas.Product)).toContain('has_required_options');
  });

  it('documents slides on create/edit, the ContentSlide model and the slide problems (Story 3.6)', () => {
    const editPath = Object.keys(doc.paths).find((p) => p.startsWith('/v1/content/') && doc.paths[p]!.patch)!;
    for (const o of [op(editPath, 'patch'), op('/v1/content', 'post')]) {
      expect(String(o.description)).toContain('media-not-attachable');
      expect(String(o.description)).toContain('slide-alt-text-required');
    }
    expect(JSON.stringify(doc.components.schemas.ContentUpdateRequest)).toContain('media_asset_id');
    expect(JSON.stringify(doc.components.schemas.ContentItem)).toContain('#/components/schemas/ContentSlide"');
    expect(JSON.stringify(doc.components.schemas.ContentSlide)).toContain('alt_text');
  });

  it('documents the media upload routes, their models and problems (Story 3.5)', () => {
    const issue = op('/v1/media/uploads', 'post');
    expect(Object.keys(issue.responses)).toEqual(expect.arrayContaining(['201', '422', '429']));
    expect(String(issue.description)).toContain('media-type-not-allowed');
    expect(String(issue.description)).toContain('Retry-After');
    const complete = op('/v1/media/uploads/:upload_id/complete', 'post');
    expect(Object.keys(complete.responses)).toEqual(expect.arrayContaining(['200', '404', '409', '410', '422']));
    expect(jsonSchema(complete.responses['200']!).$ref).toBe('#/components/schemas/MediaAsset');
    expect(jsonSchema(op('/v1/media/:id', 'get').responses['200']!).$ref).toBe('#/components/schemas/MediaAsset');
    expect(JSON.stringify(doc.components.schemas.MediaUploadRequest)).toContain('sha256');
    expect(JSON.stringify(doc.components.schemas.MediaUploadGrant)).toContain('expires_at');
  });

  it('documents the media import route, its body and problems (Story 3.7)', () => {
    const imp = op('/v1/media/imports', 'post');
    expect(Object.keys(imp.responses)).toEqual(expect.arrayContaining(['201', '400', '422', '429']));
    expect(jsonSchema(imp.responses['201']!).$ref).toBe('#/components/schemas/MediaAsset');
    expect(String(imp.description)).toContain('media-url-not-allowed');
    expect(String(imp.description)).toContain('fetch_blocked');
    expect(JSON.stringify(doc.components.schemas.MediaImportRequest)).toContain('url');
    expect(JSON.stringify(doc.components.schemas.MediaAsset)).toContain('importing');
    expect(JSON.stringify(doc.components.schemas.ContentSlide)).toContain('source_url');
  });

  it('serves a Swagger UI page pointed at the spec', () => {
    expect(docsPage()).toContain("url: '/v1/openapi.json'");
  });
});
