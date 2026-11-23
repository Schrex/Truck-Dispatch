import type { ReactNode } from 'react';
import { Loader2, Plus } from 'lucide-react';
import type { ListName } from '../../../shared/types';
import { Button } from '@/components/ui/button';
import type { NameOf, Row, SectionSpec } from './spec';

/**
 * One list on the Settings page: its entries in use as chips with their key
 * detail, and "+ Add". Removed entries are not shown.
 */
export function ListSection({
  spec,
  entries,
  failed,
  nameOf,
  onOpen,
  onAdd,
  chipControls,
}: {
  spec: SectionSpec<ListName>;
  /** null while the list loads. */
  entries: Row[] | null;
  failed: boolean;
  nameOf: NameOf;
  onOpen: (entry: Row) => void;
  onAdd: () => void;
  /** Extra controls after each chip in use, e.g. to move it up or down the list's order. */
  chipControls?: (entry: Row, index: number, inUse: Row[]) => ReactNode;
}) {
  const headingId = `section-${spec.list}`;
  const inUse = entries?.filter((e) => e.active) ?? [];
  const label = (entry: Row) => String(entry[spec.name.key]);

  return (
    <section aria-labelledby={headingId} className="flex-1 space-y-3 rounded-lg border bg-background p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 id={headingId} className="font-display text-xl font-semibold uppercase tracking-wide">
          {spec.title}
        </h2>
        <Button variant="outline" size="sm" aria-label={`Add ${spec.noun}`} onClick={onAdd} disabled={!entries}>
          <Plus className="h-4 w-4" /> Add
        </Button>
      </div>
      {failed && <p className="text-sm text-destructive">Could not load the {spec.title}. Reload the page to try again.</p>}
      {!entries && !failed && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading {spec.title}…
        </p>
      )}
      {entries && inUse.length === 0 && <p className="text-sm text-muted-foreground">No {spec.title} in use.</p>}
      {inUse.length > 0 && (
        <ul aria-label={spec.title} className="flex flex-wrap gap-x-4 gap-y-2">
          {inUse.map((entry, index) => {
            const detail = spec.detail?.(entry as never, nameOf);
            return (
              <li key={entry.id} aria-label={label(entry)} className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => onOpen(entry)}
                  className="flex min-h-11 items-center gap-2 rounded-full border bg-surface px-4 py-2 text-sm font-medium hover:bg-accent"
                >
                  {label(entry)}
                  {detail && <span className="text-xs font-normal text-muted-foreground">{detail}</span>}
                </button>
                {chipControls?.(entry, index, inUse)}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
