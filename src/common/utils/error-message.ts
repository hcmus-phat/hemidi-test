/**
 * A readable message for a thrown value, which is not always an Error.
 *
 * Some errors have an empty message. A failed connection to `localhost`, for
 * example, is an AggregateError holding one error per address tried (::1 and
 * 127.0.0.1): their messages are used instead, or else the error code.
 */
export function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  if (error.message) {
    return error.message;
  }
  if (error instanceof AggregateError && error.errors.length > 0) {
    return error.errors.map((inner) => errorMessage(inner)).join('; ');
  }
  const { code } = error as { code?: unknown };
  return typeof code === 'string' ? code : error.name;
}
