import { escapeLikePattern, LIKE_ESCAPE_CHAR } from './escape-like';

describe('escapeLikePattern', () => {
  it('uses a single backslash as the escape character', () => {
    expect(LIKE_ESCAPE_CHAR).toBe('\\');
  });

  it.each([
    ['áo thun', 'áo thun'],
    ['50%', '50\\%'],
    ['a_b', 'a\\_b'],
    ['C:\\temp', 'C:\\\\temp'],
    ['100%_off\\', '100\\%\\_off\\\\'],
    ['%%', '\\%\\%'],
    ['', ''],
  ])('escapes %j as %j', (input, expected) => {
    expect(escapeLikePattern(input)).toBe(expected);
  });
});
