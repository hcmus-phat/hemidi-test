import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Product } from './entities/product.entity';
import { ProductStockRepository } from './product-stock.repository';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  imports: [TypeOrmModule.forFeature([Product])],
  controllers: [ProductsController],
  providers: [ProductsService, ProductStockRepository],
  // Orders lock, take and give back stock through it (docs/02 §5).
  exports: [ProductStockRepository],
})
export class ProductsModule {}
