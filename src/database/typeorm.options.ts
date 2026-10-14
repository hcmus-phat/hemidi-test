import type { ConfigType } from '@nestjs/config';
import { join } from 'node:path';
import type { DataSourceOptions } from 'typeorm';
import { databaseConfig } from '../config/configuration';

/**
 * Longest wait to open one connection to Postgres (pg's
 * `connectionTimeoutMillis`, whose default 0 waits forever). Without it, a
 * database that accepts the TCP connection but never answers hangs the start
 * of every process. pg-pool also applies it to a query waiting for a free
 * connection of a full pool: that query fails after 5 s instead of waiting
 * for as long as it takes.
 */
export const DATABASE_CONNECT_TIMEOUT_MS = 5000;

/**
 * TypeORM options shared by the Nest app (`TypeOrmModule.forRootAsync`) and the
 * TypeORM CLI (`data-source.ts`), so both always connect the same way.
 *
 * Globs are relative to this file: they match the `.ts` sources in src/ when
 * the CLI runs through ts-node, and the compiled `.js` files in dist/ after
 * `nest build`.
 */
export function buildTypeOrmOptions(
  db: ConfigType<typeof databaseConfig>,
): DataSourceOptions {
  return {
    type: 'postgres',
    url: db.url,
    ssl: db.ssl,
    poolSize: db.poolMax,
    connectTimeoutMS: DATABASE_CONNECT_TIMEOUT_MS,
    // TypeORM's own 'error' logging is off: failed queries reach
    // AllExceptionsFilter, which logs the SQLSTATE and SQL of those that end
    // up as 5xx and stays quiet about expected ones (e.g. a duplicate SKU is
    // a 409). Only TypeORM warnings are logged unless SQL logging is on.
    logging: db.logging ? 'all' : ['warn'],
    entities: [join(__dirname, '..', '**', '*.entity.{ts,js}')],
    migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
    migrationsTableName: 'migrations',
    // The schema is owned by migrations only (docs/03 §7).
    synchronize: false,
    migrationsRun: false,
    // UUID defaults use gen_random_uuid(), built into Postgres 13+, so TypeORM
    // must not try to CREATE EXTENSION "uuid-ossp" on every connection.
    uuidExtension: 'pgcrypto',
    installExtensions: false,
  };
}
