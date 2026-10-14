import { Module } from '@nestjs/common';
import { NotificationsRepository } from './notifications.repository';

/**
 * Customer notifications, stored in notification_logs instead of being sent
 * (A-09). Used by OrdersModule when the worker confirms an order.
 */
@Module({
  providers: [NotificationsRepository],
  exports: [NotificationsRepository],
})
export class NotificationsModule {}
