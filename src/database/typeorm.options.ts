import type { ConfigType } from '@nestjs/config';
import { join } from 'node:path';
import type { DataSourceOptions } from 'typeorm';
import { databaseConfig } from '../config/configuration';

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
    // Failed queries reach AllExceptionsFilter, so only TypeORM warnings
    // (e.g. pool errors) are logged unless SQL logging is switched on.
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
