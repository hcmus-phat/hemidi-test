import { errorMessage, withReadableMessage } from './error-message';

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

describe('withReadableMessage', () => {
  it('returns an Error that has a message as it is', () => {
    const error = new TypeError('Redis is down');

    expect(withReadableMessage(error)).toBe(error);
  });

  it('wraps an Error with an empty message, keeping it as the cause', () => {
    const error = new AggregateError([
      new Error('connect ECONNREFUSED ::1:5432'),
      new Error('connect ECONNREFUSED 127.0.0.1:5432'),
    ]);

    const wrapped = withReadableMessage(error);

    expect(wrapped).toBeInstanceOf(Error);
    expect(wrapped.message).toBe(
      'connect ECONNREFUSED ::1:5432; connect ECONNREFUSED 127.0.0.1:5432',
    );
    expect(wrapped.cause).toBe(error);
  });

  it('wraps a thrown value that is not an Error', () => {
    const wrapped = withReadableMessage('plain string');

    expect(wrapped.message).toBe('plain string');
    expect(wrapped.cause).toBe('plain string');
  });
});
