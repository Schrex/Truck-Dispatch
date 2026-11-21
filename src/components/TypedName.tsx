import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/** A large chip's look: pressed ones filled, the rest outlined in plain text. */
export function chipClass(pressed: boolean): string {
  return cn('h-11 rounded-full px-4 text-base', pressed ? 'border border-primary' : 'text-foreground');
}

/**
 * "Or type it": the chip at the end of a Place or Material row that opens a
 * box for a name not in the list, which the Worker finds, brings back or adds.
 * Pressed while the box is open. Shared by the composer and the open
 * Assignment, so typing a name looks and works the same in both.
 */
export function OrTypeIt({ typing, onClick }: { typing: boolean; onClick: () => void }) {
  return (
    <Button type="button" variant={typing ? 'default' : 'outline'} aria-pressed={typing} className={chipClass(typing)} onClick={onClick}>
      Or type it
    </Button>
  );
}

/**
 * The box "Or type it" opens, named after its row ("Pick up, typed"). With
 * onDone, Enter or leaving the box hands over what was typed, for a part that
 * saves on its own.
 */
export function TypedBox({
  label,
  value,
  onChange,
  onDone,
}: {
  label: string;
  value: string;
  onChange: (typed: string) => void;
  onDone?: () => void;
}) {
  return (
    <Input
      aria-label={`${label}, typed`}
      autoFocus
      maxLength={100}
      className="h-11 text-base"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && onDone) {
          event.preventDefault();
          onDone();
        }
      }}
      onBlur={onDone}
    />
  );
}
