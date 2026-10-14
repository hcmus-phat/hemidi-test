import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

/**
 * Cross-field rule: the decorated number must be >= the number in `relatedProperty`
 * of the same object (e.g. `maxPrice >= minPrice`).
 *
 * The rule only compares two real numbers. A missing or non-numeric value on
 * either side passes here, because the property's own rules (`@IsInt`,
 * `@IsOptional`, ...) are responsible for reporting it.
 */
export function IsGreaterThanOrEqualTo(
  relatedProperty: string,
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isGreaterThanOrEqualTo',
      target: target.constructor,
      propertyName: String(propertyName),
      constraints: [relatedProperty],
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          const related = (args.object as Record<string, unknown>)[
            relatedProperty
          ];
          if (typeof value !== 'number' || typeof related !== 'number') {
            return true;
          }
          return value >= related;
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} must be greater than or equal to ${relatedProperty}`;
        },
      },
    });
  };
}
