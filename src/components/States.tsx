import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/** An empty state: a dashed box saying what is missing ("Nothing planned yet"), as docs/design/ui-standards.md has it. */
export function EmptyBox({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('flex min-h-11 items-center rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground', className)}>{children}</p>;
}

/** Loading: a spinner and "Loading …"; `what` names what loads ("Loading Assignments…"), or it says just "Loading…". */
export function Loading({ what, className }: { what?: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2 text-sm text-muted-foreground', className)}>
      <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> {what ? `Loading ${what}…` : 'Loading…'}
    </span>
  );
}
