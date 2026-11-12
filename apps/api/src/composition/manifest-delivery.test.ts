import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { publishEvent } from '../events/outbox.js';
import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EVENT_QUEUE, type StoreManifest } from '@slips/contracts';
import { ensureTestAppRole, runMigrations, withStoreContext } from '@slips/db';
import { HttpCdnPurger } from '../adapters/cdn/http-cdn-purger.js';
import { EnvelopeTokenCipher } from '../adapters/crypto/envelope-cipher.js';
import { MemoryObjectStorage } from '../adapters/storage/memory-storage.js';
import { PinoTelemetry } from '../adapters/telemetry/pino-telemetry.js';
import { EventHandlerRegistry, eventDispatcher } from '../events/dispatcher.js';
import { grantEventPublishing } from '../events/queue-grants.js';
import { createHttpApp } from '../http.js';
import { CatalogService } from '../modules/catalog/catalog.service.js';
import { ContentService } from '../modules/content/content.service.js';
import { ContentLifecycle } from '../modules/content/content-lifecycle.js';
import { IntegrationService } from '../modules/integration/integration.service.js';
import { lockStore } from '../modules/integration/store-lifecycle.js';
import { MediaService } from '../modules/media/media.service.js';
import { ManifestDelivery, pollManifestDeliveryStats, MANIFEST_DELIVERY_QUEUE, MANIFEST_CACHE_CONTROL, manifestKey, manifestPath, type ManifestDeliveryJob } from '../modules/publishing/manifest-delivery.js';
import { MANIFEST_COMPILE_QUEUE } from '../modules/publishing/manifest-inputs.js';
import { publishingDeliveryStoreData } from '../modules/publishing/publishing.lifecycle.js';
import { StoreManifestCompiler } from '../modules/publishing/store-manifest.js';
import type { CommercePlatform } from '../ports/commerce-platform.js';
import { registerContentEventHandlers } from '../worker/content-jobs.js';
import { publishingJobHandlers, registerPublishingEventHandlers } from '../worker/publishing-jobs.js';

const url = `postgres://slips:slips@127.0.0.1:${process.env.TEST_DATABASE_PORT ?? '5433'}/slips`;
const admin = new pg.Pool({ connectionString: url, max: 5 });
const appUrl = new URL(url); appUrl.username = 'slips_it_delivery'; appUrl.password = 'it_delivery_password';
const schema = 'pgboss_delivery_test';
const telemetry = new PinoTelemetry({ role: 'worker', level: 'silent' });
const storage = new MemoryObjectStorage();
const cache = new Map<string, { body: string; until: number }>();
let originPool: pg.Pool;
let app: pg.Pool, boss: PgBoss, integration: IntegrationService, compiler: StoreManifestCompiler, lifecycle: ContentLifecycle;
let nest: INestApplication, fixture: Server, origin: string, cdn: string, purger: HttpCdnPurger;
let rejectPurge = false;
const delivery = () => new ManifestDelivery(app, integration, storage, purger, boss, telemetry);
let dispatch: ReturnType<typeof eventDispatcher>;

beforeAll(async () => {
  await runMigrations(admin);
  await ensureTestAppRole(admin, appUrl.username, appUrl.password);
  app = new pg.Pool({ connectionString: appUrl.href, max: 8 });
  await admin.query(`drop schema if exists ${schema} cascade`);
  boss = new PgBoss({ connectionString: url, schema }); await boss.start();
  for (const queue of [EVENT_QUEUE, MANIFEST_COMPILE_QUEUE, MANIFEST_DELIVERY_QUEUE]) { await boss.createQueue(`${queue}.dead_letter`); await boss.createQueue(queue, { retryLimit: 4, retryDelay: 0, deadLetter: `${queue}.dead_letter` }); }
  await grantEventPublishing(admin, telemetry, [EVENT_QUEUE, MANIFEST_DELIVERY_QUEUE], schema);
  integration = new IntegrationService(app, {} as CommercePlatform, new EnvelopeTokenCipher({ k1: randomBytes(32).toString('base64') }, 'k1'), telemetry, boss, { dashboardUrl: 'http://localhost', stateSecret: randomBytes(32), secureCookies: false });
  const media = new MediaService(app, storage, boss, telemetry, { uploadRateLimit: 60, publicBaseUrl: 'https://media.test' });
  compiler = new StoreManifestCompiler(app, new ContentService(app), new CatalogService(app, boss, telemetry), media, integration, telemetry, boss);
  lifecycle = new ContentLifecycle(boss, telemetry, media, integration);
  const registry = new EventHandlerRegistry(); registerPublishingEventHandlers(registry, boss, telemetry, new ContentService(app)); registerContentEventHandlers(registry, telemetry, lifecycle, media); dispatch = eventDispatcher(admin, registry);
  originPool = new pg.Pool({ connectionString: appUrl.href });
  nest = await createHttpApp({ CORS_ORIGINS: 'https://dashboard.test', NODE_ENV: 'test', LOG_LEVEL: 'silent' }, {
    pool: originPool, storage, events: boss, telemetry,
    probe: { isReachable: async () => true, close: async () => {} },
  });
  await nest.listen(0, '127.0.0.1'); origin = await nest.getUrl();
  fixture = createServer((req, res) => {
    void (async () => {
      if (req.method === 'POST' && req.url === '/purge') {
        if (req.headers.authorization !== 'Bearer delivery-test-secret') { res.writeHead(401).end(); return; }
        if (rejectPurge) { res.writeHead(503).end(); return; }
        const chunks: Buffer[] = []; for await (const c of req) chunks.push(Buffer.from(c as Buffer));
        for (const path of (JSON.parse(Buffer.concat(chunks).toString()) as { paths: string[] }).paths) cache.delete(path);
        res.writeHead(204).end(); return;
      }
      const path = req.url!; const hit = cache.get(path);
      if (hit && hit.until > Date.now()) { res.writeHead(200, { 'content-type': 'application/json' }).end(hit.body); return; }
      const response = await fetch(`${origin}${path}`, { headers: { origin: 'https://shopper.test' } }); const body = await response.text();
      if (response.ok) cache.set(path, { body, until: Date.now() + 60000 });
      res.writeHead(response.status, Object.fromEntries(response.headers)).end(body);
    })().catch(() => res.writeHead(500).end());
  });
  await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve));
  cdn = `http://127.0.0.1:${(fixture.address() as { port: number }).port}`;
  purger = new HttpCdnPurger(`${cdn}/purge`, 'delivery-test-secret');
});
beforeEach(async () => {
  rejectPurge = false; storage.failing = false; cache.clear();
  for (const q of [EVENT_QUEUE, MANIFEST_COMPILE_QUEUE, MANIFEST_DELIVERY_QUEUE]) await boss.deleteAllJobs(q);
});
afterAll(async () => {
  fixture?.closeAllConnections(); await new Promise<void>((resolve) => fixture ? fixture.close(() => resolve()) : resolve());
  await nest?.close(); await boss?.stop({ graceful: false });
  await admin.query(`drop schema if exists ${schema} cascade`); await app?.end(); await admin.end();
});

async function store() {
  const id = randomUUID();
  await admin.query(`insert into stores (id,store_id,platform,platform_store_id,name) values ($1,$1,'salla',$2,'Delivery store')`, [id, `delivery-${id}`]);
  return id;
}
const platformId = (id: string) => `delivery-${id}`;
const read = async (id: string): Promise<StoreManifest> => (await fetch(`${cdn}${manifestPath(platformId(id))}`)).json() as Promise<StoreManifest>;
const state = async (id: string) => (await admin.query('select * from manifest_deliveries where store_id=$1', [id])).rows[0];
async function next() {
  const jobs = await boss.fetch<ManifestDeliveryJob>(MANIFEST_DELIVERY_QUEUE, { includeMetadata: true });
  expect(jobs).toHaveLength(1); return jobs[0]!;
}
async function phase() {
  const job = await next(); await delivery().deliver(job.data); await boss.complete(MANIFEST_DELIVERY_QUEUE, job.id); return job;
}
async function drain() { for (let n = 0; n < 30; n++) { const jobs = await boss.fetch<ManifestDeliveryJob>(MANIFEST_DELIVERY_QUEUE, { includeMetadata: true }); if (!jobs.length) return; for (const job of jobs) { await delivery().deliver(job.data); await boss.complete(MANIFEST_DELIVERY_QUEUE, job.id); } } throw new Error('delivery queue did not drain'); }
async function eventsAndCompile(id: string) {
  const events = await boss.fetch(EVENT_QUEUE, { batchSize: 100 });
  for (const event of events) { await dispatch(event.data, { id: event.id, data: event.data }); await boss.complete(EVENT_QUEUE, event.id); }
  const deadline = Date.now() + 55000;
  let count = 0;
  while (Date.now() < deadline) {
    const jobs = await boss.fetch(MANIFEST_COMPILE_QUEUE, { batchSize: 100 });
    if (jobs.length) {
      for (const job of jobs) {
        await publishingJobHandlers(app, compiler)[MANIFEST_COMPILE_QUEUE]!(job.data, {id:job.id,data:job.data});
        await boss.complete(MANIFEST_COMPILE_QUEUE,job.id); count++;
      }
      break;
    }
    await new Promise(resolve => setTimeout(resolve,100));
  }
  expect(count, `committed compile for ${id} became eligible before deadline`).toBeGreaterThan(0);
  await drain();
}

async function story(id: string) {
  const asset = randomUUID();
  await admin.query(`insert into media_assets (id,store_id,kind,status,content_type,size_bytes,upload_key,storage_key,sha256) values ($1,$2,'image','processed','image/png',10,$3,$4,repeat('a',64))`, [asset,id,`stores/${id}/uploads/${asset}`,`stores/${id}/assets/${asset}/inspected`]);
  await admin.query(`insert into renditions (store_id,asset_id,profile,content_type,width,height,size_bytes,sha256,storage_key) values ($1,$2,'web','image/webp',720,1280,10,repeat('b',64),$3)`, [id,asset,`stores/${id}/assets/${asset}/renditions/web.webp`]);
  const result = await withStoreContext(app, id, (tx) => lifecycle.create(tx,id,{ title:'Home story',format:'story',cta_label:'Shop',cta_action:'open_link',cta_url:'https://shop.test/p',placements:[{type:'home'}],slides:[{media_asset_id:asset,alt_text:'Picture'}] },new Date(),new Map([[asset,{kind:'image',status:'processed'}]])));
  return result.id;
}

describe('manifest delivery through PostgreSQL, jobs and caching HTTP', () => {
  it('serves public CORS/cache headers and unknown empty JSON without a DB read; outages are 503', async () => {
    const query = vi.spyOn(originPool,'query'); const connect = vi.spyOn(originPool,'connect');
    const response = await fetch(`${origin}/m/v1/salla/unknown.json`, { headers: { origin:'https://shopper.test' } });
    expect(response.status).toBe(200); expect(await response.json()).toEqual({v:1,store_id:'00000000-0000-0000-0000-000000000000',placements:[],items:[]});
    expect(response.headers.get('cache-control')).toBe(MANIFEST_CACHE_CONTROL); expect(response.headers.get('access-control-allow-origin')).toBe('*'); expect(response.headers.get('access-control-allow-credentials')).toBeNull(); expect(query).not.toHaveBeenCalled(); expect(connect).not.toHaveBeenCalled(); query.mockRestore(); connect.mockRestore();
    storage.failing=true; const down=await fetch(`${origin}/m/v1/salla/unknown.json`); expect(down.status).toBe(503); expect(down.headers.get('cache-control')).toBe('no-store'); storage.failing=false;
  });
  it('publish/edit/unpublish/archive/delete refresh a primed cache within 60s including event dispatch and compile', async () => {
    const id=await store(); const contentId=await story(id); await compiler.compile(id); await drain(); expect((await read(id)).items).toHaveLength(0);
    const timings: Record<string, number> = {};
    for (const action of ['publish','edit','deactivate','reactivate','archive','undo_archive','delete'] as const) {
      const started=Date.now(); await read(id);
      await withStoreContext(app,id,tx => action==='edit' ? lifecycle.edit(tx,id,contentId,{title:'Edited Home story'}) : lifecycle.apply(tx,id,contentId,action));
      await eventsAndCompile(id); const result=await read(id);
      expect(result.items.length).toBe(['deactivate','archive','delete'].includes(action)?0:1);
      if(action==='edit') expect(result.items[0]!.title).toBe('Edited Home story');
      timings[action]=Date.now()-started; expect(timings[action]).toBeLessThan(60000);
    }
    expect(storage.objects.get(manifestKey(platformId(id)))?.cacheControl).toBe(MANIFEST_CACHE_CONTROL);
    console.info('Measured cache freshness ms (real pg-boss eligibility):', timings);
  }, 180000);
  it('rollbacks create neither checkpoints nor delivery jobs; committed compiles enqueue atomically', async () => {
    const id=await store();
    await expect(withStoreContext(app,id,async()=>{await compiler.compile(id);throw new Error('rollback');})).rejects.toThrow('rollback');
    expect(await state(id)).toBeUndefined(); expect(await boss.fetch(MANIFEST_DELIVERY_QUEUE)).toHaveLength(0);
    await compiler.compile(id); await drain(); expect((await state(id)).delivered_at).toBeInstanceOf(Date);
  });
  it('retries storage and purge separately across restarts using persisted pg-boss jobs and upload checkpoints', async () => {
    const id=await store(); await compiler.compile(id); const job=await next(); storage.failing=true;
    await expect(delivery().deliver(job.data)).rejects.toThrow(); await boss.fail(MANIFEST_DELIVERY_QUEUE,job.id); storage.failing=false;
    const retry=await next(); expect(retry.retryCount).toBe(1); await delivery().deliver(retry.data); await boss.complete(MANIFEST_DELIVERY_QUEUE,retry.id);
    expect((await state(id)).uploaded_hash).toBeTruthy(); expect((await state(id)).delivered_at).toBeNull();
    const gauges=vi.spyOn(telemetry,'gauge'); await pollManifestDeliveryStats(app,telemetry); expect(gauges.mock.calls.some(([name,value])=>name==='slips_manifest_delivery_pending' && value>0)).toBe(true); gauges.mockRestore();
    rejectPurge=true; const purge=await next(); const put=vi.spyOn(storage,'put');
    await expect(delivery().deliver(purge.data,true)).rejects.toThrow(); await boss.fail(MANIFEST_DELIVERY_QUEUE,purge.id); expect((await state(id)).failed).toBe(true);
    rejectPurge=false; await admin.query("update stores set lifecycle_state='disconnected' where id=$1",[id]); await drain(); expect(put).not.toHaveBeenCalled(); put.mockRestore(); expect((await state(id)).delivered_hash).toBe((await state(id)).content_hash);
  });
  it('persists exhausted failure and emits an alert metric after all real queue attempts fail', async () => {
    const id=await store(); await compiler.compile(id); await phase(); rejectPurge=true;
    const failures=vi.spyOn(telemetry,'counter');
    const handler=publishingJobHandlers(app,compiler,delivery())[MANIFEST_DELIVERY_QUEUE]!;
    for(let attempt=0;attempt<5;attempt++) {
      const job=await next(); expect(job.retryCount).toBe(attempt);
      await expect(handler(job.data,job)).rejects.toThrow(); await boss.fail(MANIFEST_DELIVERY_QUEUE,job.id);
    }
    expect(await boss.fetch(MANIFEST_DELIVERY_QUEUE)).toHaveLength(0);
    expect(await boss.fetch(`${MANIFEST_DELIVERY_QUEUE}.dead_letter`)).toHaveLength(1);
    expect((await state(id)).failed).toBe(true);
    expect(failures.mock.calls.some(([name,labels])=>name==='slips_manifest_delivery_failures_total' && labels?.exhausted==='true')).toBe(true); failures.mockRestore(); rejectPurge=false;
  });
  it('deduplicates completed output, retries pending purges, and repairs A→uploaded B→A', async () => {
    const id=await store(); const contentId=await story(id); await withStoreContext(app,id,tx=>lifecycle.apply(tx,id,contentId,'publish')); await compiler.compile(id); await drain();
    const put=vi.spyOn(storage,'put'); const purge=vi.spyOn(purger,'purge'); await compiler.compile(id); await drain(); expect(put).not.toHaveBeenCalled(); expect(purge).not.toHaveBeenCalled();
    await withStoreContext(app,id,tx=>lifecycle.edit(tx,id,contentId,{title:'B'})); await compiler.compile(id); await phase();
    await withStoreContext(app,id,tx=>lifecycle.edit(tx,id,contentId,{title:'Home story'})); await compiler.compile(id); await drain();
    expect((await read(id)).items[0]!.title).toBe('Home story'); expect(put).toHaveBeenCalledTimes(2); expect(purge).toHaveBeenCalledTimes(1);
    put.mockRestore(); purge.mockRestore();
  });
  it('repairs A after a B PUT applies but the upload transaction fails before acknowledgement', async () => {
    const id=await store(); const contentId=await story(id); await withStoreContext(app,id,tx=>lifecycle.apply(tx,id,contentId,'publish')); await compiler.compile(id); await drain();
    await withStoreContext(app,id,tx=>lifecycle.edit(tx,id,contentId,{title:'B'})); await compiler.compile(id);
    const job=await next(); const put=storage.put.bind(storage);
    const spy=vi.spyOn(storage,'put').mockImplementationOnce(async(...args)=>{await put(...args);throw new Error('process lost after PUT');});
    await expect(delivery().deliver(job.data)).rejects.toThrow('process lost after PUT'); await boss.fail(MANIFEST_DELIVERY_QUEUE,job.id); spy.mockRestore();
    expect((await state(id)).uploaded_hash).toBeNull(); expect((await state(id)).delivered_hash).toBeNull();
    expect(JSON.parse(storage.objects.get(manifestKey(platformId(id)))!.body.toString()).items[0].title).toBe('B');
    await withStoreContext(app,id,tx=>lifecycle.edit(tx,id,contentId,{title:'Home story'})); await compiler.compile(id); await drain();
    expect((await read(id)).items[0]!.title).toBe('Home story'); expect((await state(id)).delivered_hash).toBe((await state(id)).content_hash);
  });
  it('keeps earliest pending lag across duplicate compiles and completes the pending purge', async () => {
    const id=await store(); const first=new Date(Date.now()-10000); await compiler.compile(id,{occurredAt:first}); await phase(); await compiler.compile(id);
    expect((await state(id)).requested_at.getTime()).toBe(first.getTime()); await drain(); expect((await state(id)).delivered_at).toBeTruthy();
  });
  it('retains unresolved request age across changed hashes, resetting after completion or a new epoch', async () => {
    const id=await store(); const contentId=await story(id); await withStoreContext(app,id,tx=>lifecycle.apply(tx,id,contentId,'publish'));
    const first=new Date(Date.now()-10000); await compiler.compile(id,{occurredAt:first}); await phase();
    for (const title of ['Second hash','Third hash']) {
      await withStoreContext(app,id,tx=>lifecycle.edit(tx,id,contentId,{title})); await compiler.compile(id);
      expect((await state(id)).requested_at.getTime()).toBe(first.getTime());
    }
    await drain();
    const nextRequest=new Date(); await withStoreContext(app,id,tx=>lifecycle.edit(tx,id,contentId,{title:'Completed prior work'})); await compiler.compile(id,{occurredAt:nextRequest});
    expect((await state(id)).requested_at.getTime()).toBe(nextRequest.getTime());
    const epochRequest=new Date(Date.now()+1000); await withStoreContext(app,id,tx=>tx.query('update stores set install_epoch=2 where id=$1',[id])); await compiler.compile(id,{occurredAt:epochRequest});
    expect((await state(id)).requested_at.getTime()).toBe(epochRequest.getTime());
  });
  it('backfills an already-compiled active store through the executable operator procedure', async () => {
    const id=await store(); await admin.query(`insert into store_manifests (store_id,revision,manifest,size_gzip_bytes,compiled_at) values ($1,1,$2::jsonb,10,now())`,[id,JSON.stringify({v:1,store_id:id,placements:[],items:[]})]);
    expect(await state(id)).toBeUndefined(); expect((await read(id)).store_id).toBe('00000000-0000-0000-0000-000000000000');
    await promisify(execFile)(process.execPath,['--import','tsx','scripts/manifest-delivery-ops.ts','backfill',id],{env:{...process.env,DATABASE_URL:url,PG_BOSS_SCHEMA:schema}});
    await eventsAndCompile(id); expect((await read(id)).store_id).toBe(id); expect((await state(id)).delivered_at).toBeTruthy();
    const status=await promisify(execFile)(process.execPath,['--import','tsx','scripts/manifest-delivery-ops.ts','status',id],{env:{...process.env,DATABASE_URL:url,PG_BOSS_SCHEMA:schema}}); const checkpoint=JSON.parse(status.stdout.trim().split('\n').at(-1)!); expect(checkpoint.manifestPresent).toBe(true); expect(checkpoint.delivery[0].delivered_hash).toBe(checkpoint.delivery[0].content_hash);
  },60000);
  it('operator redrive preserves compile, upload, purge and cleanup payloads and phases', async () => {
    const id=await store();
    for (const kind of ['compile','upload','purge','cleanup-upload','cleanup-purge']) {
      const queue=kind==='compile'?MANIFEST_COMPILE_QUEUE:MANIFEST_DELIVERY_QUEUE;
      const payload={v:1,trace_id:'operator-recovery',store_id:id,occurred_at:new Date(Date.now()-10000).toISOString(),...(kind==='compile'?{}:{install_epoch:1,platform_store_id:platformId(id),revision:1,cleanup:kind.startsWith('cleanup'),phase:kind.endsWith('purge')?'purge':'upload'})};
      await boss.send(queue,payload,{retryLimit:0}); const [job]=await boss.fetch(queue); expect(job).toBeDefined(); await boss.fail(queue,job!.id);
      const result=await promisify(execFile)(process.execPath,['--import','tsx','scripts/manifest-delivery-ops.ts','redrive',kind,id],{env:{...process.env,DATABASE_URL:url,PG_BOSS_SCHEMA:schema}});
      expect(JSON.parse(result.stdout).moved).toBe(1);
      const [recovered]=await boss.fetch(queue); expect(recovered?.data).toEqual(payload); await boss.complete(queue,recovered!.id);
      expect(await boss.findJobs(`${queue}.dead_letter`,{data:{store_id:id}})).toHaveLength(0);
    }
  },60000);
  it('final purged event removes rows recreated by a compile between module purge and markPurged', async () => {
    const id=await store(); await compiler.compile(id); await drain();
    await withStoreContext(app,id,async tx=>{await lockStore(tx);await tx.query("update stores set lifecycle_state='uninstalled' where id=$1",[id]);await publishingDeliveryStoreData(boss,telemetry).purge({storeId:id,installEpoch:1,tx,batchLimit:10});});
    await compiler.compile(id); expect(await state(id)).toBeDefined();
    await withStoreContext(app,id,async tx=>{await lockStore(tx);await tx.query("update stores set lifecycle_state='purged' where id=$1",[id]);await publishEvent(tx,boss,telemetry,'integration.store.purged',{v:1,store_id:id,install_epoch:1});});
    await eventsAndCompile(id);
    expect(await state(id)).toBeUndefined(); expect((await admin.query('select * from store_manifests where store_id=$1',[id])).rowCount).toBe(0); expect((await read(id)).items).toEqual([]);
    const status=await promisify(execFile)(process.execPath,['--import','tsx','scripts/manifest-delivery-ops.ts','status',id],{env:{...process.env,DATABASE_URL:url,PG_BOSS_SCHEMA:schema}}); expect(JSON.parse(status.stdout.trim().split('\n').at(-1)!)).toEqual({delivery:[],manifestPresent:false});
  },60000);
  it('serializes writes against compilation and lifecycle; obsolete revisions and epochs cannot overwrite', async () => {
    const id=await store(); await compiler.compile(id); const old=await next();
    let entered!:()=>void, release!:()=>void; const gate=new Promise<void>(r=>release=r); const started=new Promise<void>(r=>entered=r);
    const put=storage.put.bind(storage); const spy=vi.spyOn(storage,'put').mockImplementation(async(...args)=>{entered();await gate;await put(...args);});
    const running=delivery().deliver(old.data); await started;
    let compiled=false; const newer=compiler.compile(id).then(()=>{compiled=true;}); await new Promise(r=>setTimeout(r,50)); expect(compiled).toBe(false);
    release(); await running; await boss.complete(MANIFEST_DELIVERY_QUEUE,old.id); await newer; spy.mockRestore(); await drain();
    const before=storage.objects.get(manifestKey(platformId(id)))!.body.toString(); await delivery().deliver(old.data); expect(storage.objects.get(manifestKey(platformId(id)))!.body.toString()).toBe(before);
    await withStoreContext(app,id,async tx=>{await lockStore(tx);await tx.query('update stores set install_epoch=install_epoch+1 where id=$1',[id]);});
    const writes=vi.spyOn(storage,'put'); await delivery().deliver(old.data); expect(writes).not.toHaveBeenCalled(); writes.mockRestore();
  });
  it('disconnect retains last good; uninstall empties; purge cleanup survives row removal and skips reinstall', async () => {
    const id=await store(); const contentId=await story(id); await withStoreContext(app,id,tx=>lifecycle.apply(tx,id,contentId,'publish')); await compiler.compile(id); await drain(); expect((await read(id)).items).toHaveLength(1);
    await admin.query("update stores set lifecycle_state='disconnected' where id=$1",[id]); expect(await compiler.compile(id)).toEqual({outcome:'skipped_disconnected'}); expect((await read(id)).items).toHaveLength(1);
    await admin.query("update stores set lifecycle_state='uninstalled' where id=$1",[id]); await compiler.compile(id); await drain(); expect((await read(id)).items).toHaveLength(0);
    const cleanup=publishingDeliveryStoreData(boss,telemetry); await withStoreContext(app,id,async tx=>{await lockStore(tx);await cleanup.purge({storeId:id,installEpoch:1,tx,batchLimit:10});});
    expect(await state(id)).toBeUndefined(); expect((await admin.query('select * from store_manifests where store_id=$1',[id])).rowCount).toBe(0);
    await phase(); rejectPurge=true; const purge=await next(); await expect(delivery().deliver(purge.data)).rejects.toThrow(); await boss.fail(MANIFEST_DELIVERY_QUEUE,purge.id); rejectPurge=false; await drain(); expect(await state(id)).toBeUndefined();
    await withStoreContext(app,id,tx=>tx.query("update stores set install_epoch=2,lifecycle_state='active' where id=$1",[id])); await compiler.compile(id); await drain(); expect((await read(id)).items).toHaveLength(1);
    await delivery().deliver({...purge.data,phase:'upload'}); expect((await read(id)).items).toHaveLength(1);
  });
});
