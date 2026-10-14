import {
  buildRedisConnection,
  parseRedisUrl,
  RedisConnectionRole,
} from './redis-connection';

describe('parseRedisUrl', () => {
  it('reads host and port, with 6379 as the default port', () => {
    expect(parseRedisUrl('redis://localhost:6380')).toEqual({
      host: 'localhost',
      port: 6380,
    });
    expect(parseRedisUrl('redis://redis.internal')).toEqual({
      host: 'redis.internal',
      port: 6379,
    });
  });

  it('reads and decodes the username, password and database number', () => {
    expect(parseRedisUrl('redis://default:p%40ss%3Aword@cache:6379/2')).toEqual(
      {
        host: 'cache',
        port: 6379,
        username: 'default',
        password: 'p@ss:word',
        db: 2,
      },
    );
  });

  it('accepts a password without a username', () => {
    expect(parseRedisUrl('redis://:secret@cache')).toEqual({
      host: 'cache',
      port: 6379,
      password: 'secret',
    });
  });

  it('turns TLS on for rediss://', () => {
    expect(parseRedisUrl('rediss://user:pw@redis.cloud:12345')).toEqual({
      host: 'redis.cloud',
      port: 12345,
      username: 'user',
      password: 'pw',
      tls: {},
    });
    expect(parseRedisUrl('redis://cache').tls).toBeUndefined();
  });

  it('removes the brackets of an IPv6 host', () => {
    expect(parseRedisUrl('redis://[::1]:6379').host).toBe('::1');
  });

  it.each(['redis://cache/abc', 'redis://cache/-1', 'redis://cache/1.5'])(
    'rejects %s, whose database is not a non-negative integer',
    (url) => {
      expect(() => parseRedisUrl(url)).toThrow(
        'REDIS_URL database must be a non-negative integer',
      );
    },
  );
});

describe('buildRedisConnection', () => {
  const url = 'rediss://user:pw@redis.cloud:12345/1';
  const parsed = {
    host: 'redis.cloud',
    port: 12345,
    username: 'user',
    password: 'pw',
    db: 1,
    tls: {},
  };

  it('fails fast for the API: commands are not queued while Redis is down', () => {
    expect(buildRedisConnection(url, RedisConnectionRole.Api)).toEqual({
      ...parsed,
      enableOfflineQueue: false,
    });
  });

  it('lets the worker wait for Redis, as BullMQ requires for a Worker', () => {
    expect(buildRedisConnection(url, RedisConnectionRole.Worker)).toEqual({
      ...parsed,
      maxRetriesPerRequest: null,
    });
  });
});
