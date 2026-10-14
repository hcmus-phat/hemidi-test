import { HttpStatus } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsInt,
  IsUUID,
  Min,
  ValidateNested,
  ValidationError,
} from 'class-validator';
import { createValidationPipe } from '../pipes/validation.pipe';
import { AppException } from './app.exception';
import { ErrorCode } from './error-codes';
import { flattenValidationErrors } from './validation-exception.factory';

const P1 = '11111111-1111-4111-8111-111111111111';

class ItemDto {
  @IsUUID('4')
  productId: string;

  @IsInt()
  @Min(1)
  quantity: number;
}

class OrderDto {
  @IsEmail()
  customerEmail: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ItemDto)
  items: ItemDto[];
}

describe('validationExceptionFactory', () => {
  const pipe = createValidationPipe();

  async function validate(body: unknown): Promise<unknown> {
    return pipe
      .transform(body, { type: 'body', metatype: OrderDto })
      .catch((error: unknown) => error);
  }

  it('returns a 400 VALIDATION_ERROR with one entry per invalid field, using dotted paths', async () => {
    const error = await validate({
      customerEmail: 'not-an-email',
      items: [
        { productId: P1, quantity: 0 },
        { productId: 'abc', quantity: 1, discount: 10 },
      ],
      coupon: 'FREE',
    });

    expect(error).toBeInstanceOf(AppException);
    const exception = error as AppException;
    expect(exception.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(exception.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(exception.message).toBe('Request validation failed');
    expect(exception.details).toHaveLength(5);
    expect(exception.details).toEqual(
      expect.arrayContaining([
        {
          field: 'customerEmail',
          messages: ['customerEmail must be an email'],
        },
        {
          field: 'items.0.quantity',
          messages: ['quantity must not be less than 1'],
        },
        { field: 'items.1.productId', messages: ['productId must be a UUID'] },
        {
          field: 'items.1.discount',
          messages: ['property discount should not exist'],
        },
        { field: 'coupon', messages: ['property coupon should not exist'] },
      ]),
    );
  });

  it('reports every failed rule of a field together', async () => {
    const error = (await validate({
      customerEmail: 'a@example.com',
      items: [{ productId: P1, quantity: 'two' }],
    })) as AppException;

    expect(error.details).toEqual([
      {
        field: 'items.0.quantity',
        messages: expect.arrayContaining([
          'quantity must be an integer number',
          'quantity must not be less than 1',
        ]),
      },
    ]);
  });

  it('returns the transformed DTO when the body is valid', async () => {
    const result = await validate({
      customerEmail: 'a@example.com',
      items: [{ productId: P1, quantity: 2 }],
    });

    expect(result).toBeInstanceOf(OrderDto);
    expect((result as OrderDto).items[0]).toBeInstanceOf(ItemDto);
  });
});

describe('flattenValidationErrors', () => {
  it('skips levels without constraints and keeps the full path', () => {
    const leaf = Object.assign(new ValidationError(), {
      property: 'quantity',
      constraints: { min: 'quantity must not be less than 1' },
      children: [],
    });
    const item = Object.assign(new ValidationError(), {
      property: '2',
      children: [leaf],
    });
    const items = Object.assign(new ValidationError(), {
      property: 'items',
      children: [item],
    });

    expect(flattenValidationErrors([items])).toEqual([
      {
        field: 'items.2.quantity',
        messages: ['quantity must not be less than 1'],
      },
    ]);
  });

  it('returns an empty list when there are no errors', () => {
    expect(flattenValidationErrors([])).toEqual([]);
  });
});
