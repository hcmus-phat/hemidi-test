import { Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { databaseConfig } from '../config/configuration';
import { buildTypeOrmOptions } from './typeorm.options';

/**
 * How many times a process tries to connect to the database when it starts,
 * and the pause between two tries. Each try lasts at most
 * DATABASE_CONNECT_TIMEOUT_MS (5 s), so a start against a database that
 * never answers fails after about 3 × 5 s + 2 × 2 s = 19 s, and one against a
 * refused connection after a few seconds. That stays within the 30 s
 * maxDuration of the Vercel function, which then answers 503 (src/vercel.ts).
 * The @nestjs/typeorm default, 10 tries 3 s apart, took about 27 s even with
 * an immediate refusal.
 *
 * main.ts and worker.ts exit when the start fails; their platform restarts
 * them (Railway: restart policy On failure).
 */
export const DATABASE_CONNECT_ATTEMPTS = 3;
export const DATABASE_CONNECT_RETRY_DELAY_MS = 2000;

/**
 * The TypeORM connection, shared by the API (AppModule) and the worker
 * (WorkerModule) so both connect with the same options as the CLI.
 * The DataSource is closed in onApplicationShutdown.
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [databaseConfig.KEY],
      useFactory: (db: ConfigType<typeof databaseConfig>) => ({
        ...buildTypeOrmOptions(db),
        retryAttempts: DATABASE_CONNECT_ATTEMPTS,
        retryDelay: DATABASE_CONNECT_RETRY_DELAY_MS,
      }),
    }),
  ],
})
export class DatabaseModule {}
