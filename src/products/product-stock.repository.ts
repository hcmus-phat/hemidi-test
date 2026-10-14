import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Product } from './entities/product.entity';

/**
 * Stock queries used by orders. Every method takes the EntityManager of the
 * caller's transaction (docs/02 §8), so the lock and the stock updates belong
 * to the same transaction as the order they serve.
 */
@Injectable()
export class ProductStockRepository {
  /**
   * Locks the given products that are not deleted, in ONE statement:
   *
   *   SELECT ... FROM products
   *    WHERE id IN (...) AND deleted_at IS NULL
   *    ORDER BY id
   *      FOR UPDATE
   *
   * - Another transaction that wants one of these rows waits until this one
   *   ends, then reads the latest stock: no two orders can both take the last
   *   item (docs/06 §4).
   * - Postgres locks the rows in id order, the same order every transaction
   *   uses, so two orders with the same products cannot deadlock (docs/06 §5).
   * - TypeORM adds `deleted_at IS NULL` itself (@DeleteDateColumn).
   *
   * Ids that do not exist or are deleted are simply missing from the result.
   * Must run inside a transaction (TypeORM refuses a lock outside of one).
   */
  findActiveForUpdate(
    manager: EntityManager,
    productIds: string[],
  ): Promise<Product[]> {
    return manager
      .createQueryBuilder(Product, 'product')
      .where('product.id IN (:...productIds)', { productIds })
      .orderBy('product.id', 'ASC')
      .setLock('pessimistic_write')
      .getMany();
  }

  /**
   * `stock = stock - quantity`. Relative, so it never overwrites a concurrent
   * change, and CHECK (stock >= 0) rejects a negative result as a last line
   * of defence. The caller has already locked the row and checked the stock.
   */
  async decrementStock(
    manager: EntityManager,
    productId: string,
    quantity: number,
  ): Promise<void> {
    await this.addToStock(manager, productId, -quantity);
  }

  /**
   * `stock = stock + quantity`, when an order gives its stock back. There is
   * no `deleted_at` filter on purpose: a product deleted after the order was
   * placed still gets its stock back, so the count is right if it is ever
   * restored (docs/03 §6).
   */
  async incrementStock(
    manager: EntityManager,
    productId: string,
    quantity: number,
  ): Promise<void> {
    await this.addToStock(manager, productId, quantity);
  }

  /** `UPDATE products SET stock = stock + :delta, updated_at = now() WHERE id = :productId` */
  private async addToStock(
    manager: EntityManager,
    productId: string,
    delta: number,
  ): Promise<void> {
    await manager
      .createQueryBuilder()
      .update(Product)
      .set({ stock: () => 'stock + :delta' })
      .where('id = :productId')
      .setParameters({ productId, delta })
      .execute();
  }
}
