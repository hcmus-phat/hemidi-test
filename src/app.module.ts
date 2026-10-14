import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { configModuleOptions } from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { OrdersModule } from './orders/orders.module';
import { ProductsModule } from './products/products.module';
import { QueueModule } from './queue/queue.module';
import { RedisConnectionRole } from './queue/redis-connection';

/**
 * Root module of the HTTP API. It must never import a BullMQ processor or
 * the outbox relay: those belong to WorkerModule (docs/02 §2). Redis is only
 * used to read job states and by GET /health, with fail-fast connection
 * options.
 */
@Module({
  imports: [
    ConfigModule.forRoot(configModuleOptions),
    DatabaseModule,
    QueueModule.forRoot(RedisConnectionRole.Api),
    ProductsModule,
    OrdersModule,
    HealthModule,
  ],
})
export class AppModule {}
