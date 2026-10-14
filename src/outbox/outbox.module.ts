import { Module } from '@nestjs/common';
import { OutboxRepository } from './outbox.repository';

/**
 * Transactional Outbox (ADR-003). The API only writes events, inside the
 * transaction that creates an order. The relay that publishes them to the
 * queue runs in the worker and is registered there, never in the API.
 */
@Module({
  providers: [OutboxRepository],
  exports: [OutboxRepository],
})
export class OutboxModule {}
