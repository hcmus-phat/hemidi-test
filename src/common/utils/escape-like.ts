/** Escape character used with `LIKE ... ESCAPE '\'` (a single backslash). */
export const LIKE_ESCAPE_CHAR = '\\';

/**
 * Escapes the LIKE wildcards `%` and `_` (and the escape character itself) so a
 * user's search term is matched literally: searching "50%" must not match
 * every name that contains "50".
 */
export function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `${LIKE_ESCAPE_CHAR}${char}`);
}
