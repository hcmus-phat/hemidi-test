import { errorMessage } from './error-message';

describe('errorMessage', () => {
  it('returns the message of an Error', () => {
    expect(errorMessage(new Error('Redis is down'))).toBe('Redis is down');
  });

  it('turns a value that is not an Error into a string', () => {
    expect(errorMessage('plain string')).toBe('plain string');
    expect(errorMessage(42)).toBe('42');
  });

  it('joins the messages of an AggregateError without a message of its own', () => {
    // What a refused connection to `localhost` looks like (IPv6, then IPv4).
    const error = new AggregateError([
      new Error('connect ECONNREFUSED ::1:6379'),
      new Error('connect ECONNREFUSED 127.0.0.1:6379'),
    ]);

    expect(errorMessage(error)).toBe(
      'connect ECONNREFUSED ::1:6379; connect ECONNREFUSED 127.0.0.1:6379',
    );
  });

  it('falls back to the error code, then to the error name', () => {
    const withCode = Object.assign(new Error(''), { code: 'ECONNREFUSED' });
    expect(errorMessage(withCode)).toBe('ECONNREFUSED');
    expect(errorMessage(new TypeError(''))).toBe('TypeError');
  });
});
