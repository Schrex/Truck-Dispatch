import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Loader2 } from 'lucide-react';
import type { ListName } from '../../../shared/types';
import { Field } from '@/components/Field';
import { ListPicker } from '@/components/ListPicker';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { addEntry, changeEntry, FieldErrors } from '@/lib/api';
import { choicesOf, LIST_TITLES } from '@/lib/lists';
import type { ListField, Row, SectionSpec } from './spec';

/** How long typing has to pause before it is saved, so a word is one save rather than one per letter. */
const TYPING_PAUSE_MS = 400;

type Form = Record<string, string | null>;
type Status = 'idle' | 'saving' | 'saved' | 'failed';

/** What a field's control shows for a saved value: a choice's value may be shown as another one. */
function shown(field: ListField<ListName> | null, value: unknown): string | null {
  const saved = (value as string | null) ?? null;
  return field?.kind === 'choice' && saved && field.shownAs?.[saved] ? field.shownAs[saved] : saved;
}

/**
 * Edits one entry, saving each field as Dave changes it: text once typing
 * pauses (or the panel closes), a pick at once. A new entry (entry null) is
 * added once it has a name, then changed like any other. Remove asks first;
 * a removed entry offers Bring back instead. Nothing is ever deleted.
 */
export function EntryPanel({
  spec,
  entry,
  others,
  unloaded,
  onSaved,
  onClose,
  children,
}: {
  spec: SectionSpec<ListName>;
  /** The entry to edit, or null to add one. */
  entry: Row | null;
  /** Every list as loaded, for the pickers. */
  others: Partial<Record<ListName, Row[]>>;
  /** Lists that could not be loaded. */
  unloaded: ListName[];
  onSaved: (entry: Row) => void;
  onClose: () => void;
  /** Extra controls for the entry, shown under its fields. */
  children?: ReactNode;
}) {
  const nameKey = spec.name.key;
  const keys = [nameKey, ...spec.fields.map((f) => f.key)];
  const fieldOf = (key: string) => spec.fields.find((f) => f.key === key) ?? null;
  const [form, setForm] = useState<Form>(() => Object.fromEntries(keys.map((key) => [key, entry ? shown(fieldOf(key), entry[key]) : null])));
  const [saved, setSaved] = useState<Row | null>(entry);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Status>('idle');
  const [asking, setAsking] = useState(false);

  // Saves run one after another, each reading the latest form and entry, so a
  // new entry is added once before any change to it.
  const formRef = useRef(form);
  const savedRef = useRef(saved);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const keep = (row: Row) => {
    savedRef.current = row;
    setSaved(row);
    onSaved(row);
  };

  /** Queues a save; fields null saves the given key's current value. */
  function save(body: Record<string, unknown> | string) {
    chain.current = chain.current.then(async () => {
      const current = savedRef.current;
      let fields: Record<string, unknown>;
      if (typeof body === 'string') {
        if (!current) {
          // A new entry is added with everything filled in so far, once it has a name.
          if (!formRef.current[nameKey]?.trim()) return;
          fields = Object.fromEntries(Object.entries(formRef.current).filter(([, value]) => value));
        } else fields = { [body]: formRef.current[body] };
      } else {
        if (!current) return;
        fields = body;
      }
      setStatus('saving');
      try {
        keep((current ? await changeEntry(spec.list, current.id, fields as never) : await addEntry(spec.list, fields as never)) as unknown as Row);
        setStatus('saved');
      } catch (error) {
        if (error instanceof FieldErrors) {
          setErrors((now) => ({ ...now, ...error.fields }));
          setStatus('idle');
        } else setStatus('failed');
      }
    });
    return chain.current;
  }

  /** Saves every field still waiting for typing to pause. */
  function flush() {
    for (const [key, timer] of timers.current) {
      clearTimeout(timer);
      void save(key);
    }
    timers.current.clear();
  }

  useEffect(() => () => flush(), []);

  function set(key: string, value: string | null, { typing }: { typing: boolean }) {
    formRef.current = { ...formRef.current, [key]: value };
    setForm(formRef.current);
    setErrors(({ [key]: _gone, ...rest }) => rest);
    clearTimeout(timers.current.get(key));
    timers.current.delete(key);
    if (!typing) void save(key);
    else
      timers.current.set(
        key,
        setTimeout(() => {
          timers.current.delete(key);
          void save(key);
        }, TYPING_PAUSE_MS),
      );
  }

  function close() {
    flush();
    onClose();
  }

  async function setActive(active: boolean) {
    flush();
    await save({ active });
  }

  const title = saved ? String(saved[nameKey]) : `New ${spec.noun}`;
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display text-xl uppercase tracking-wide">{title}</DialogTitle>
          <DialogDescription>
            {saved
              ? `${spec.noun}${saved.active ? '' : ', removed'}. Changes save as you type; a new name shows on every Assignment that uses it.`
              : `A new ${spec.noun}, saved once it has a ${spec.name.label.toLowerCase()}.`}
          </DialogDescription>
        </DialogHeader>
        {/* A form so Enter saves at once, and so each picker has its native control. */}
        <form
          className="grid gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            flush();
          }}
        >
          <Field id={nameKey} label={spec.name.label} error={errors[nameKey]}>
            <Input id={nameKey} required value={form[nameKey] ?? ''} onChange={(e) => set(nameKey, e.target.value, { typing: true })} />
          </Field>
          {spec.fields.map((field) => {
            const failed = field.kind === 'pick' && unloaded.includes(field.list) ? LIST_TITLES[field.list] : null;
            return (
              <Field key={field.key} id={field.key} label={field.label} optional error={errors[field.key] ?? (failed ? `Could not load the ${failed}.` : undefined)}>
                {field.kind === 'text' ? (
                  <Input id={field.key} value={form[field.key] ?? ''} onChange={(e) => set(field.key, e.target.value, { typing: true })} />
                ) : (
                  <ListPicker
                    id={field.key}
                    label={field.label}
                    empty={field.empty}
                    choices={
                      field.kind === 'choice'
                        ? field.choices.map((c) => ({ id: c.value, label: c.label, active: true }))
                        : choicesOf(field.list, (others[field.list] as never) ?? null)
                    }
                    value={form[field.key] ?? null}
                    onChange={(value) => set(field.key, value, { typing: false })}
                    failed={Boolean(failed)}
                  />
                )}
              </Field>
            );
          })}
          {saved && spec.status && <p className="text-sm font-medium">{spec.status(saved as never)}</p>}
          {children}
          <SaveStatus status={status} />
        </form>
        <DialogFooter className="gap-2 sm:justify-between">
          {saved &&
            (saved.active ? (
              <Button type="button" variant="outline" className="text-destructive" onClick={() => setAsking(true)}>
                Remove
              </Button>
            ) : (
              <Button type="button" variant="outline" onClick={() => setActive(true)}>
                Bring back
              </Button>
            ))}
          <Button type="button" onClick={close}>
            Done
          </Button>
        </DialogFooter>
        {asking && saved && (
          <ConfirmRemove
            spec={spec}
            entry={saved}
            onKeep={() => setAsking(false)}
            onRemove={async () => {
              setAsking(false);
              await setActive(false);
              if (savedRef.current && !savedRef.current.active) onClose();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Says whether the latest change is saved, so Dave never wonders. */
function SaveStatus({ status }: { status: Status }) {
  if (status === 'saving')
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Saving…
      </p>
    );
  if (status === 'saved')
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Check className="h-4 w-4" /> Saved
      </p>
    );
  if (status === 'failed')
    return (
      <p className="text-sm text-destructive" role="alert">
        Could not save. Check the connection and try again.
      </p>
    );
  return null;
}

/** Asks before removing an entry, with the list's own warning (a Driver's later days) once the Worker answers. */
function ConfirmRemove({ spec, entry, onKeep, onRemove }: { spec: SectionSpec<ListName>; entry: Row; onKeep: () => void; onRemove: () => void }) {
  const [warning, setWarning] = useState<string | null>(null);
  const name = String(entry[spec.name.key]);

  useEffect(() => {
    let current = true;
    spec.removeWarning?.(entry as never).then(
      (text) => current && setWarning(text),
      () => current && setWarning(`Could not check whether ${name} still has work planned.`),
    );
    return () => {
      current = false;
    };
  }, [entry.id]);

  return (
    <Dialog open onOpenChange={(open) => !open && onKeep()}>
      <DialogContent role="alertdialog">
        <DialogHeader>
          <DialogTitle className="font-display text-xl uppercase tracking-wide">Remove {name}?</DialogTitle>
          <DialogDescription>
            {name} is left off the Board's lists. Old Assignments keep the name, and the {spec.noun} can be brought back from Settings.
          </DialogDescription>
        </DialogHeader>
        {warning && <p className="text-sm font-medium text-destructive">{warning}</p>}
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onKeep}>
            Keep
          </Button>
          <Button type="button" onClick={onRemove}>
            Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
