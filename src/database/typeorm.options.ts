import type { ConfigType } from '@nestjs/config';
import type { DataSourceOptions } from 'typeorm';
import { databaseConfig } from '../config/configuration';
import { NotificationLog } from '../notifications/entities/notification-log.entity';
import { OrderItem } from '../orders/entities/order-item.entity';
import { Order } from '../orders/entities/order.entity';
import { OutboxEvent } from '../outbox/entities/outbox-event.entity';
import { Product } from '../products/entities/product.entity';
import { CreateProducts1791994096385 } from './migrations/1791994096385-CreateProducts';
import { CreateOrders1791997199582 } from './migrations/1791997199582-CreateOrders';
import { CreateOutboxEvents1791997371346 } from './migrations/1791997371346-CreateOutboxEvents';
import { CreateNotificationLogs1792002007329 } from './migrations/1792002007329-CreateNotificationLogs';

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
 * Entities and migrations are listed as classes, not as file globs: the
 * Vercel function runs a bundle (scripts/bundle-vercel.js), in which a glob
 * relative to __dirname no longer points at these files. A new migration
 * must be added to MIGRATIONS (docs/03 §7).
 */
const ENTITIES = [Product, Order, OrderItem, OutboxEvent, NotificationLog];

/** In the order they run. */
const MIGRATIONS = [
  CreateProducts1791994096385,
  CreateOrders1791997199582,
  CreateOutboxEvents1791997371346,
  CreateNotificationLogs1792002007329,
];

/**
 * TypeORM options shared by the Nest app (`TypeOrmModule.forRootAsync`) and the
 * TypeORM CLI (`data-source.ts`), so both always connect the same way.
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
    entities: ENTITIES,
    migrations: MIGRATIONS,
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
