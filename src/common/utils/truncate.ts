/**
 * Cuts `text` to at most `maxLength` characters, ending with '…' when it was
 * cut. Used for error messages stored in the database, which can be long
 * (e.g. a message that embeds a stack or a payload).
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}…`;
}
