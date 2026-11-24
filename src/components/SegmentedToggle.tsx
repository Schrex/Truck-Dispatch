import { useId } from 'react';
import { Button } from '@/components/ui/button';

/**
 * A choice between a few options (ui-standards.md › Controls): a muted
 * track, the chosen one filled yellow with a shadow. Tapping the chosen one
 * keeps it chosen. With `label` shown above it; with only `ariaLabel`, bare.
 */
export function SegmentedToggle<T extends string>({
  label,
  ariaLabel,
  options,
  value,
  onChange,
}: {
  label?: string;
  ariaLabel?: string;
  /** A disabled option is shown but cannot be chosen yet. */
  options: { value: T; label: string; disabled?: boolean }[];
  value: T | null;
  onChange: (value: T) => void;
}) {
  const labelId = useId();
  const track = (
    <div
      role="group"
      aria-label={label ? undefined : ariaLabel}
      aria-labelledby={label ? labelId : undefined}
      className="inline-flex flex-wrap items-center gap-0.5 rounded-lg border bg-muted/60 p-1"
    >
      {options.map((option) => {
        const chosen = option.value === value;
        return (
          <Button
            key={option.value}
            type="button"
            size="sm"
            variant={chosen ? 'default' : 'ghost'}
            aria-pressed={chosen}
            disabled={option.disabled}
            className={chosen ? 'h-11 px-4 text-sm shadow-sm' : 'h-11 px-4 text-sm text-muted-foreground hover:bg-background/70'}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </Button>
        );
      })}
    </div>
  );
  if (!label) return track;
  return (
    <div className="space-y-2">
      <p id={labelId} className="text-sm font-medium">
        {label}
      </p>
      {track}
    </div>
  );
}
