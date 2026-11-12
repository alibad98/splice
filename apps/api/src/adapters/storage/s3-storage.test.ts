// S3 adapter: the presigned PUT URL (offline), plus a live MinIO round-trip that is skipped when port 9000 is down.
import { createHash, randomUUID } from 'node:crypto';
import { connect } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { S3ObjectStorage } from './s3-storage.js';

const config = {
  endpoint: 'http://127.0.0.1:9000',
  region: 'us-east-1',
  bucket: 'slips-media-test',
  accessKeyId: 'slips',
  secretAccessKey: 'slips-local-only',
  forcePathStyle: true,
};

const minioUp = await new Promise<boolean>((resolve) => {
  const socket = connect({ host: '127.0.0.1', port: 9000, timeout: 500 });
  socket.once('connect', () => {
    socket.destroy();
    resolve(true);
  });
  socket.once('error', () => resolve(false));
  socket.once('timeout', () => {
    socket.destroy();
    resolve(false);
  });
});

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

describe('S3ObjectStorage presignPut (offline)', () => {
  it('signs content-type, content-length and the sha256 checksum header, and expires in 15 minutes', async () => {
    const storage = new S3ObjectStorage(config);
    const body = Buffer.from('hello');
    const grant = await storage.presignPut({ key: 'stores/s1/uploads/abc', contentType: 'image/png', sizeBytes: body.length, sha256Hex: sha(body), expiresInSeconds: 900 });
    const url = new URL(grant.url);
    expect(url.pathname).toBe('/slips-media-test/stores/s1/uploads/abc');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
    const signed = url.searchParams.get('X-Amz-SignedHeaders')!.split(';');
    expect(signed).toEqual(expect.arrayContaining(['content-length', 'content-type', 'host', 'x-amz-checksum-sha256']));
    // The checksum stays a header (storage verifies the body against it); it is not hoisted into the query.
    expect(url.searchParams.has('x-amz-checksum-sha256')).toBe(false);
    expect(grant).toMatchObject({ method: 'PUT', headers: { 'content-type': 'image/png', 'x-amz-checksum-sha256': Buffer.from(sha(body), 'hex').toString('base64') } });
    storage.destroy();
  });
});

describe('S3ObjectStorage bucket CORS (offline, Story 3.6)', () => {
  type Sendable = { send: (cmd: { constructor: { name: string }; input: unknown }) => Promise<unknown> };

  it('allows PUT with the signed headers from the configured origins', async () => {
    const storage = new S3ObjectStorage({ ...config, corsOrigins: ['https://app.example'] });
    const send = vi.fn().mockResolvedValue({});
    (storage as unknown as { client: Sendable }).client.send = send;
    await storage.ensureCors();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0].input).toEqual({
      Bucket: 'slips-media-test',
      CORSConfiguration: {
        CORSRules: [
          { AllowedOrigins: ['https://app.example'], AllowedMethods: ['PUT'], AllowedHeaders: ['content-type', 'x-amz-checksum-sha256'], ExposeHeaders: ['etag'], MaxAgeSeconds: 3600 },
        ],
      },
    });
    storage.destroy();
  });

  it('logs and continues when storage refuses the call, and skips it without origins', async () => {
    const warn = vi.fn();
    const storage = new S3ObjectStorage({ ...config, corsOrigins: ['https://app.example'], warn });
    (storage as unknown as { client: Sendable }).client.send = vi.fn().mockRejectedValue(new Error('NotImplemented'));
    await expect(storage.ensureCors()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('media bucket CORS not set', { bucket: 'slips-media-test', error: 'NotImplemented' });

    const none = new S3ObjectStorage(config);
    const send = vi.fn();
    (none as unknown as { client: Sendable }).client.send = send;
    await none.ensureCors();
    expect(send).not.toHaveBeenCalled();
    storage.destroy();
    none.destroy();
  });
});

describe.skipIf(!minioUp)('S3ObjectStorage against MinIO (live)', () => {
  it('round-trips a presigned PUT, refuses a different body, and deletes by prefix', async () => {
    const storage = new S3ObjectStorage(config);
    await storage.ensureBucket();
    const prefix = `stores/${randomUUID()}/`;
    const body = Buffer.from('slips media round trip');
    const key = `${prefix}uploads/${sha(body)}`;
    const grant = await storage.presignPut({ key, contentType: 'image/png', sizeBytes: body.length, sha256Hex: sha(body), expiresInSeconds: 900 });

    const tampered = Buffer.from('slips media round trlp');
    const bad = await fetch(grant.url, { method: 'PUT', headers: grant.headers, body: tampered });
    expect(bad.ok).toBe(false);
    expect(await storage.head(key)).toBeNull();

    const res = await fetch(grant.url, { method: 'PUT', headers: grant.headers, body });
    expect(res.status).toBe(200);
    expect(await storage.head(key)).toEqual({ sizeBytes: body.length, contentType: 'image/png' });
    const stream = await storage.getStream(key);
    const chunks: Buffer[] = [];
    for await (const c of stream!) chunks.push(Buffer.from(c as Buffer));
    expect(Buffer.concat(chunks).equals(body)).toBe(true);

    await storage.put(`${prefix}assets/a/original.png`, body, 'image/png');
    expect(await storage.deletePrefix(prefix, 1)).toEqual({ deleted: 1, done: false });
    expect(await storage.deletePrefix(prefix, 10)).toEqual({ deleted: 1, done: true });
    expect(await storage.head(key)).toBeNull();
    expect(await storage.getStream(key)).toBeNull();
    await storage.delete(key);
    storage.destroy();
  });
});

describe('manifest object metadata', () => {
  it('passes cache metadata on PUT without changing private source uploads', async () => {
    const storage = new S3ObjectStorage(config);
    const send = vi.fn().mockResolvedValue({});
    (storage as unknown as { client: { send: typeof send } }).client.send = send;
    await storage.put('m/v1/salla/123.json', Buffer.from('{}'), 'application/json', { cacheControl: 'public, max-age=60, stale-while-revalidate=60' });
    expect(send.mock.calls[0]![0].input).toMatchObject({ Key: 'm/v1/salla/123.json', ContentType: 'application/json', CacheControl: 'public, max-age=60, stale-while-revalidate=60' });
    expect(send.mock.calls[0]![0].input.ACL).toBeUndefined();
    await storage.put('stores/private/uploads/source', Buffer.from('source'), 'image/png');
    expect(send.mock.calls[1]![0].input.CacheControl).toBeUndefined();
    storage.destroy();
  });
});

describe('manifest origin storage failures and write deadline', () => {
  it('only treats an explicit missing-key GET as absent', async () => {
    const storage=new S3ObjectStorage(config); const send=vi.fn();
    (storage as unknown as {client:{send:typeof send}}).client.send=send;
    send.mockRejectedValueOnce({name:'NoSuchKey',$metadata:{httpStatusCode:404}});
    await expect(storage.getStream('m/v1/salla/missing.json')).resolves.toBeNull();
    for (const error of [{name:'NoSuchBucket',$metadata:{httpStatusCode:404}},{name:'ProxyFailure',$metadata:{httpStatusCode:404}},{name:'NotFound',$metadata:{httpStatusCode:404}}]) {
      send.mockRejectedValueOnce(error); await expect(storage.getStream('m/v1/salla/store.json')).rejects.toBe(error);
    }
    send.mockResolvedValueOnce({}); await expect(storage.getStream('m/v1/salla/store.json')).rejects.toThrow('returned no body');
    storage.destroy();
  });
  it('aborts a stalled manifest PUT through the SDK while private-media PUTs keep existing options', async () => {
    const storage=new S3ObjectStorage({...config,manifestPutTimeoutMs:20});
    const send=vi.fn().mockImplementation((_command:unknown,options?:{abortSignal?:AbortSignal})=>options?.abortSignal ? new Promise((_resolve,reject)=>options.abortSignal!.addEventListener('abort',()=>reject(new Error('SDK request aborted')),{once:true})) : Promise.resolve({}));
    (storage as unknown as {client:{send:typeof send}}).client.send=send;
    await expect(storage.put('m/v1/salla/store.json',Buffer.from('{}'),'application/json')).rejects.toThrow('SDK request aborted');
    expect(send.mock.calls[0]![1]!.abortSignal!.aborted).toBe(true);
    await storage.put('stores/private/uploads/source',Buffer.from('source'),'image/png'); expect(send.mock.calls[1]).toHaveLength(1);
    storage.destroy();
  });
});
