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

/**
 * `error` as an Error whose message is never empty, for code that keeps only
 * `error.message`. BullMQ, for example, stores only the message as a job's
 * failedReason, which GET /orders/:id/jobs shows.
 *
 * An Error that has a message is returned as it is, keeping its class (such
 * as BullMQ's UnrecoverableError) and its stack. Anything else (an Error with
 * an empty message, or a thrown value that is not an Error) is wrapped in a
 * new Error with `errorMessage(error)` as its message and the original value
 * as its `cause`.
 */
export function withReadableMessage(error: unknown): Error {
  if (error instanceof Error && error.message) {
    return error;
  }
  return new Error(errorMessage(error), { cause: error });
}
