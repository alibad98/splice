import { describe, expect, it } from 'vitest';
import { EnvError, parseEnv } from './env.js';

const base = { ROLE: 'http', DATABASE_URL: 'postgres://slips:slips@localhost:5432/slips' };

describe('parseEnv', () => {
  it('parses a valid http env with defaults', () => {
    const env = parseEnv(base);
    expect(env.ROLE).toBe('http');
    expect(env.PORT).toBe(3001);
    expect(env.WORKER_QUEUES).toEqual(['realtime', 'media', 'batch']);
  });

  it('parses a worker env with a queue subset', () => {
    const env = parseEnv({ ...base, ROLE: 'worker', WORKER_QUEUES: 'realtime, batch' });
    expect(env.WORKER_QUEUES).toEqual(['realtime', 'batch']);
  });

  it('names DATABASE_URL when it is missing', () => {
    expect.assertions(3);
    const rest: Record<string, string> = { ...base };
    delete rest.DATABASE_URL;
    expect(() => parseEnv(rest)).toThrow(EnvError);
    try {
      parseEnv(rest);
    } catch (err) {
      expect((err as EnvError).variables).toEqual(['DATABASE_URL']);
      expect((err as EnvError).message).toContain('DATABASE_URL');
    }
  });

  it('treats an empty WORKER_QUEUES as unset', () => {
    expect(parseEnv({ ...base, WORKER_QUEUES: '  ' }).WORKER_QUEUES).toEqual(['realtime', 'media', 'batch']);
  });

  it('rejects an invalid ROLE', () => {
    expect(() => parseEnv({ ...base, ROLE: 'cron' })).toThrow(/ROLE/);
  });

  it('rejects an unknown queue group and names it', () => {
    expect(() => parseEnv({ ...base, ROLE: 'worker', WORKER_QUEUES: 'realtime,email' })).toThrow(/WORKER_QUEUES: unknown queue group\(s\): email/);
  });
});
