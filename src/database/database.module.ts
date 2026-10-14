import { Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { databaseConfig } from '../config/configuration';
import { buildTypeOrmOptions } from './typeorm.options';

/**
 * The TypeORM connection, shared by the API (AppModule) and the worker
 * (WorkerModule) so both connect with the same options as the CLI.
 * The DataSource is closed in onApplicationShutdown.
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [databaseConfig.KEY],
      useFactory: (db: ConfigType<typeof databaseConfig>) =>
        buildTypeOrmOptions(db),
    }),
  ],
})
export class DatabaseModule {}
