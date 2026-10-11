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

  it('rejects PORT equal to WORKER_HEALTH_PORT', () => {
    expect(() => parseEnv({ ROLE: 'http', DATABASE_URL: 'postgres://u:p@localhost:5432/db', PORT: '3002', WORKER_HEALTH_PORT: '3002' })).toThrow(/WORKER_HEALTH_PORT/);
  });

  describe('token encryption and Salla settings', () => {
    const key = Buffer.alloc(32, 7).toString('base64');
    it('are optional outside production and empty strings count as unset', () => {
      const env = parseEnv({ ...base, TOKEN_ENCRYPTION_KEY: '', SALLA_CLIENT_ID: '' });
      expect(env.TOKEN_ENCRYPTION_KEY).toBeUndefined();
      expect(env.TOKEN_ENCRYPTION_KEY_ID).toBe('k1');
      expect(env.DASHBOARD_URL).toBe('http://localhost:3000');
    });
    it('rejects a master key that is not 32 bytes without echoing it', () => {
      expect.assertions(2);
      try {
        parseEnv({ ...base, TOKEN_ENCRYPTION_KEY: 'c2hvcnQ=' });
      } catch (err) {
        expect((err as EnvError).variables).toEqual(['TOKEN_ENCRYPTION_KEY']);
        expect((err as EnvError).message).not.toContain('c2hvcnQ=');
      }
    });
    it('accepts an optional SESSION_COOKIE_DOMAIN and rejects a malformed one', () => {
      expect(parseEnv({ ...base }).SESSION_COOKIE_DOMAIN).toBeUndefined();
      expect(parseEnv({ ...base, SESSION_COOKIE_DOMAIN: 'slips.app' }).SESSION_COOKIE_DOMAIN).toBe('slips.app');
      expect(() => parseEnv({ ...base, SESSION_COOKIE_DOMAIN: 'bad; Path=/' })).toThrow(/SESSION_COOKIE_DOMAIN/);
    });

    it('rejects a short OAUTH_STATE_SECRET', () => {
      expect(() => parseEnv({ ...base, OAUTH_STATE_SECRET: 'short' })).toThrow(/OAUTH_STATE_SECRET/);
    });
    it('requires the key and Salla credentials in production', () => {
      expect.assertions(2);
      try {
        parseEnv({ ...base, NODE_ENV: 'production' });
      } catch (err) {
        expect((err as EnvError).variables).toEqual(['TOKEN_ENCRYPTION_KEY', 'OAUTH_STATE_SECRET', 'SALLA_CLIENT_ID', 'SALLA_CLIENT_SECRET', 'SALLA_REDIRECT_URI']);
      }
      const ok = parseEnv({ ...base, NODE_ENV: 'production', TOKEN_ENCRYPTION_KEY: key, OAUTH_STATE_SECRET: 's'.repeat(32), SALLA_CLIENT_ID: 'id', SALLA_CLIENT_SECRET: 'secret-123', SALLA_REDIRECT_URI: 'https://api.example.com/cb' });
      expect(ok.TOKEN_ENCRYPTION_KEY).toBe(key);
    });
  });
});
