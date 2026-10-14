import { Module } from '@nestjs/common';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { configModuleOptions, databaseConfig } from './config/configuration';
import { buildTypeOrmOptions } from './database/typeorm.options';
import { OrdersModule } from './orders/orders.module';
import { ProductsModule } from './products/products.module';
import { QueueModule } from './queue/queue.module';
import { RedisConnectionRole } from './queue/redis-connection';

/**
 * Root module of the HTTP API. It must never import a BullMQ processor or
 * the outbox relay: those belong to WorkerModule (docs/02 §2). Redis is only
 * used to read job states, with fail-fast connection options.
 */
@Module({
  imports: [
    ConfigModule.forRoot(configModuleOptions),
    TypeOrmModule.forRootAsync({
      inject: [databaseConfig.KEY],
      useFactory: (db: ConfigType<typeof databaseConfig>) =>
        buildTypeOrmOptions(db),
    }),
    QueueModule.forRoot(RedisConnectionRole.Api),
    ProductsModule,
    OrdersModule,
  ],
})
export class AppModule {}
