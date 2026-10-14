import { validateSync } from 'class-validator';
import { IsGreaterThanOrEqualTo } from './is-greater-than-or-equal-to.decorator';

class Range {
  min?: unknown;

  @IsGreaterThanOrEqualTo('min')
  max?: unknown;
}

function failsRule(min: unknown, max: unknown): boolean {
  const errors = validateSync(Object.assign(new Range(), { min, max }));
  return errors.some(
    (error) => error.constraints?.isGreaterThanOrEqualTo !== undefined,
  );
}

describe('IsGreaterThanOrEqualTo', () => {
  it('fails when the value is lower than the related property', () => {
    expect(failsRule(10, 9)).toBe(true);
  });

  it('uses the documented message', () => {
    const [error] = validateSync(
      Object.assign(new Range(), { min: 10, max: 9 }),
    );

    expect(error.constraints).toEqual({
      isGreaterThanOrEqualTo: 'max must be greater than or equal to min',
    });
  });

  it.each([
    [10, 10],
    [10, 11],
    [0, 0],
  ])('passes for min=%j, max=%j', (min, max) => {
    expect(failsRule(min, max)).toBe(false);
  });

  // Each property's own rules report these values, so this rule stays silent
  // instead of adding a second, misleading message.
  it.each([
    [undefined, 5],
    [5, undefined],
    [Number.NaN, 5],
    [5, Number.NaN],
    ['abc', 5],
    [10, '5'],
    [Number.POSITIVE_INFINITY, 5],
  ])('ignores min=%j, max=%j', (min, max) => {
    expect(failsRule(min, max)).toBe(false);
  });
});
