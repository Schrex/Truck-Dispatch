import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Choice } from '@/lib/lists';
import { Loading } from '@/components/States';

/** The empty choice. Radix Select cannot use '' as a value. */
const NONE = 'none';

/**
 * A plain Select over one list, with an empty choice first. It offers active
 * entries, plus the one currently chosen if it has since been made inactive, so
 * editing something else never wipes it.
 */
export function ListPicker({
  id,
  label,
  empty,
  choices,
  value,
  onChange,
  failed = false,
}: {
  /** The field's id; also the name of the picker's form control. */
  id: string;
  label: string;
  /** The empty choice, e.g. "No Truck". */
  empty: string;
  /** null while the list loads. */
  choices: Choice[] | null;
  value: string | null;
  onChange: (value: string | null) => void;
  /** The list could not be loaded, so it never will be: the picker says so instead of loading. */
  failed?: boolean;
}) {
  const shown = choices?.filter((choice) => choice.active || choice.id === value) ?? [];
  return (
    <Select name={id} value={value ?? NONE} onValueChange={(next) => onChange(next === NONE ? null : next)} disabled={!choices}>
      <SelectTrigger id={id} aria-label={label}>
        <SelectValue placeholder={choices ? empty : failed ? 'Not available' : <Loading />} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{empty}</SelectItem>
        {shown.map((choice) => (
          <SelectItem key={choice.id} value={choice.id}>
            {choice.label}
            {!choice.active && ' (inactive)'}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
