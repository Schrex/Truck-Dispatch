/**
 * An Assignment's plain columns: values kept as they are, not references to
 * a list entry, such as the note (api.ts lists them in PLAIN). Each is
 * declared once, with how Start from and Copy to copy it, and what it reads
 * as in a saved copy older than the column, so the values kept before each
 * change and Changed ("was …") take it without a case of their own.
 */
export interface PlainColumn {
  /** Its field on the Assignment, and its key in the values kept before a change. */
  key: string;
  /** Its column in the assignments table. */
  column: string;
  /**
   * How Start from and Copy to copy it, as is: always, or only when `when`
   * (SQL on the source row, `a`) holds, else left empty. Left out: not copied.
   */
  copy?: 'always' | { when: string };
  /** What it reads as in values kept before a change that were saved before it existed. */
  missing: string | null;
}

/** The SELECT expressions copying the plain columns a copy takes, each named as its column; the source row is `a`. */
export function copiedPlain(columns: readonly PlainColumn[]): string[] {
  return columns.flatMap(({ column, copy }) => {
    if (!copy) return [];
    if (copy === 'always') return [`a.${column} AS ${column}`];
    return [`CASE WHEN ${copy.when} THEN a.${column} END AS ${column}`];
  });
}

/** The plain columns' pairs for the json_object of the values kept before a change; the row is `b`. */
export function plainBefore(columns: readonly PlainColumn[]): string {
  return columns.map(({ key, column }) => `'${key}', b.${column}`).join(', ');
}

/**
 * The plain columns that differ from the values kept before a change (compared
 * as is), each with the value it had then. One missing from those values reads
 * as its declared default, so an older saved copy shows no false "was".
 */
export function plainWas(now: object, before: object, columns: readonly PlainColumn[]): Record<string, unknown> {
  const was: Record<string, unknown> = {};
  const [current, kept] = [now as Record<string, unknown>, before as Record<string, unknown>];
  for (const { key, missing } of columns) {
    const then = key in kept ? kept[key] ?? null : missing;
    if (then !== (current[key] ?? null)) was[key] = then;
  }
  return was;
}
