import { truncate } from './truncate';

describe('truncate', () => {
  it('keeps a text that fits', () => {
    expect(truncate('Redis is down', 13)).toBe('Redis is down');
    expect(truncate('', 5)).toBe('');
  });

  it('cuts a longer text to the maximum length, ending with an ellipsis', () => {
    const result = truncate('connect ECONNREFUSED 127.0.0.1:6379', 10);

    expect(result).toBe('connect E…');
    expect(result).toHaveLength(10);
  });
});
