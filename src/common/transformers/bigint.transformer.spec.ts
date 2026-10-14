import { BigIntTransformer } from './bigint.transformer';

describe('BigIntTransformer', () => {
  describe('from (database -> entity)', () => {
    it.each([
      ['199000', 199000],
      ['0', 0],
      ['-5', -5],
      ['50000000000000', 50_000_000_000_000],
      [String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER],
    ])('converts %j to the number %d', (input, expected) => {
      expect(BigIntTransformer.from(input)).toBe(expected);
    });

    it('keeps null and undefined (nullable columns)', () => {
      expect(BigIntTransformer.from(null)).toBeNull();
      expect(BigIntTransformer.from(undefined)).toBeUndefined();
    });

    it('throws instead of losing precision above Number.MAX_SAFE_INTEGER', () => {
      expect(() => BigIntTransformer.from('9007199254740993')).toThrow(
        'bigint value out of safe range: 9007199254740993',
      );
    });

    it('throws on a value that is not an integer', () => {
      expect(() => BigIntTransformer.from('12.5')).toThrow();
      expect(() => BigIntTransformer.from('abc')).toThrow();
    });
  });

  describe('to (entity -> database)', () => {
    it('passes values through unchanged', () => {
      expect(BigIntTransformer.to(199000)).toBe(199000);
      expect(BigIntTransformer.to(null)).toBeNull();
      expect(BigIntTransformer.to(undefined)).toBeUndefined();
    });
  });
});
