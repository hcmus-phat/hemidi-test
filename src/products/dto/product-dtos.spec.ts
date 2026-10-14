import { AppException } from '../../common/errors/app.exception';
import { createValidationPipe } from '../../common/pipes/validation.pipe';
import { CreateProductDto } from './create-product.dto';
import { UpdateProductDto } from './update-product.dto';

const pipe = createValidationPipe();

async function validate(
  metatype: typeof CreateProductDto | typeof UpdateProductDto,
  body: unknown,
): Promise<unknown> {
  return pipe
    .transform(body, { type: 'body', metatype })
    .catch((error: unknown) => error);
}

function invalidFields(result: unknown): string[] {
  expect(result).toBeInstanceOf(AppException);
  return ((result as AppException).details ?? []).map((d) => d.field as string);
}

describe('CreateProductDto', () => {
  const valid = {
    sku: 'TSHIRT-WHITE-M',
    name: 'Áo thun trắng size M',
    price: 199000,
    stock: 50,
  };

  it('trims and upper-cases the SKU and trims the name', async () => {
    const dto = await validate(CreateProductDto, {
      ...valid,
      sku: '  tshirt-white_m ',
      name: '  Áo thun  ',
    });

    expect(dto).toBeInstanceOf(CreateProductDto);
    expect(dto).toMatchObject({ sku: 'TSHIRT-WHITE_M', name: 'Áo thun' });
  });

  it.each([
    ['sku', 'TSHIRT WHITE'],
    ['sku', 'ÁO-01'],
    ['sku', '   '],
    ['sku', 'A'.repeat(65)],
    ['sku', 123],
    ['name', '   '],
    ['name', 'x'.repeat(256)],
    ['price', 1.5],
    ['price', -1],
    ['price', 1_000_000_001],
    ['price', '199000'],
    ['stock', -1],
    ['stock', 1_000_001],
    ['stock', 2.5],
  ])('rejects %s=%j', async (field, value) => {
    const result = await validate(CreateProductDto, {
      ...valid,
      [field]: value,
    });

    expect(invalidFields(result)).toEqual([field]);
  });

  it('accepts the boundaries', async () => {
    const dto = await validate(CreateProductDto, {
      sku: 'A',
      name: 'x'.repeat(255),
      price: 1_000_000_000,
      stock: 0,
    });

    expect(dto).toBeInstanceOf(CreateProductDto);
  });

  it('requires every field', async () => {
    expect(invalidFields(await validate(CreateProductDto, {})).sort()).toEqual([
      'name',
      'price',
      'sku',
      'stock',
    ]);
  });

  it('rejects unknown fields', async () => {
    const result = await validate(CreateProductDto, { ...valid, color: 'red' });

    expect(invalidFields(result)).toEqual(['color']);
  });
});

describe('UpdateProductDto', () => {
  it('accepts an empty body', async () => {
    expect(await validate(UpdateProductDto, {})).toBeInstanceOf(
      UpdateProductDto,
    );
  });

  it('applies the same normalisation and rules as on creation', async () => {
    expect(await validate(UpdateProductDto, { sku: ' abc ' })).toMatchObject({
      sku: 'ABC',
    });
    expect(
      invalidFields(await validate(UpdateProductDto, { price: -5 })),
    ).toEqual(['price']);
  });

  it('rejects explicit null values instead of writing NULL', async () => {
    const result = await validate(UpdateProductDto, {
      name: null,
      stock: null,
    });

    expect(invalidFields(result).sort()).toEqual(['name', 'stock']);
  });
});
