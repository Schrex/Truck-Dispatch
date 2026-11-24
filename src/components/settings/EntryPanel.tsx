import { useEffect, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import type { ListName } from '../../../shared/types';
import { Field } from '@/components/Field';
import { ListPicker } from '@/components/ListPicker';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/sonner';
import { addEntry, changeEntry, FieldErrors } from '@/lib/api';
import { choicesOf, LIST_TITLES } from '@/lib/lists';
import type { FormValues, ListField, Row, SectionSpec } from './spec';

type Form = FormValues;

/** What a field's control shows for a saved value: a choice's value may be shown as another one; a switch is on or off. */
function shown(field: ListField<ListName> | null, value: unknown): string | boolean | null {
  if (field?.kind === 'switch') return value === true;
  const saved = (value as string | null) ?? null;
  return field?.kind === 'choice' && saved && field.shownAs?.[saved] ? field.shownAs[saved] : saved;
}

/** A text value as it is saved: trimmed, empty as nothing. */
const tidy = (value: string | boolean | null) => (typeof value === 'string' ? value.trim() || null : value);

/**
 * Adds or edits one entry. Nothing is saved until Dave taps Save, which saves
 * what he changed and closes the panel; Cancel, Esc or a tap outside closes it
 * and drops the changes. Adding the name of a removed entry brings that entry
 * back. Remove asks first, drops any unsaved changes and closes the panel.
 * Nothing is ever deleted.
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
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [asking, setAsking] = useState(false);

  function set(key: string, value: string | boolean | null) {
    setForm((now) => ({ ...now, [key]: value }));
    setErrors(({ [key]: _gone, ...rest }) => rest);
    setFailed(false);
  }

  /**
   * What Save sends: for a new entry everything filled in; for a saved one only
   * what differs from it. A field the panel is not asking for is left to the
   * Worker (a Place that stops being a job site loses its usual Foreman there).
   */
  function changes(): Record<string, unknown> {
    const asked = [nameKey, ...spec.fields.filter((f) => !f.shownWhen || f.shownWhen(form)).map((f) => f.key)];
    const sent = asked.map((key) => [key, tidy(form[key])] as const);
    if (!entry) return Object.fromEntries(sent.filter(([key, value]) => key === nameKey || value));
    return Object.fromEntries(sent.filter(([key, value]) => value !== tidy(shown(fieldOf(key), entry[key]))));
  }

  /** Runs one save, showing a refusal by its fields and a failure in the panel; answers whether it was saved. */
  async function run(write: () => Promise<void>): Promise<boolean> {
    setSaving(true);
    setFailed(false);
    try {
      await write();
      return true;
    } catch (error) {
      if (error instanceof FieldErrors) setErrors(error.fields);
      else setFailed(true);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function save() {
    const fields = changes();
    if (entry && Object.keys(fields).length === 0) return onClose();
    const saved = await run(async () => {
      if (entry) {
        const row = (await changeEntry(spec.list, entry.id, fields as never)) as unknown as Row;
        onSaved(row);
        toast.success(`${String(row[nameKey])} saved`);
      } else {
        const { entry: added, broughtBack } = await addEntry(spec.list, fields as never);
        const row = added as unknown as Row;
        onSaved(row);
        toast.success(`${String(row[nameKey])} ${broughtBack ? 'brought back' : 'added'}`);
      }
    });
    if (saved) onClose();
  }

  async function remove(saved: Row) {
    setAsking(false);
    const removed = await run(async () => {
      onSaved((await changeEntry(spec.list, saved.id, { active: false } as never)) as unknown as Row);
      toast.success(`${String(saved[nameKey])} removed`);
    });
    if (removed) onClose();
  }

  const title = entry ? String(entry[nameKey]) : `New ${spec.noun}`;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display text-xl uppercase tracking-wide">{title}</DialogTitle>
          <DialogDescription>
            {entry
              ? `${spec.noun}. Nothing changes until you tap Save; ${spec.renamed ?? 'a new name shows on every Assignment that uses it.'}`
              : `A new ${spec.noun}. Nothing is added until you tap Save.`}
          </DialogDescription>
        </DialogHeader>
        {/* A form so Enter saves, and so each picker has its native control. */}
        <form
          id={`entry-${spec.list}`}
          className="grid gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <Field id={nameKey} label={spec.name.label} error={errors[nameKey]}>
            <Input id={nameKey} required value={String(form[nameKey] ?? '')} onChange={(e) => set(nameKey, e.target.value)} />
          </Field>
          {spec.fields.filter((field) => !field.shownWhen || field.shownWhen(form)).map((field) => {
            if (field.kind === 'switch')
              return (
                <div key={field.key} className="space-y-1">
                  <div className="flex items-center gap-3">
                    <Switch id={field.key} checked={form[field.key] === true} onCheckedChange={(on) => set(field.key, on)} />
                    <Label htmlFor={field.key}>{field.label}</Label>
                  </div>
                  <p className="text-xs text-muted-foreground">{field.hint}</p>
                  {errors[field.key] && (
                    <p className="text-xs text-destructive" role="alert">
                      {errors[field.key]}
                    </p>
                  )}
                </div>
              );
            const unloadedList = field.kind === 'pick' && unloaded.includes(field.list) ? LIST_TITLES[field.list] : null;
            return (
              <Field key={field.key} id={field.key} label={field.label} optional error={errors[field.key] ?? (unloadedList ? `Could not load the ${unloadedList}.` : undefined)}>
                {field.kind === 'text' ? (
                  <Input id={field.key} value={String(form[field.key] ?? '')} onChange={(e) => set(field.key, e.target.value)} />
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
                    value={(form[field.key] as string | null) ?? null}
                    onChange={(value) => set(field.key, value)}
                    failed={Boolean(unloadedList)}
                  />
                )}
                {field.kind === 'pick' && field.hint && <p className="text-xs text-muted-foreground">{field.hint(form)}</p>}
              </Field>
            );
          })}
          {entry && spec.status && <p className="text-sm font-medium">{spec.status(entry as never)}</p>}
          {children}
          {failed && (
            <p className="text-sm text-destructive" role="alert">
              Could not save. Check the connection and try again.
            </p>
          )}
        </form>
        <DialogFooter className="gap-2 sm:justify-between">
          {/* Remove keeps to the left, away from Save, so neither is tapped for the other. */}
          {entry?.active ? (
            <Button type="button" variant="outline" className="text-destructive" disabled={saving} onClick={() => setAsking(true)}>
              Remove
            </Button>
          ) : (
            <span />
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" form={`entry-${spec.list}`} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save
            </Button>
          </div>
        </DialogFooter>
        {asking && entry && <ConfirmRemove spec={spec} entry={entry} onKeep={() => setAsking(false)} onRemove={() => remove(entry)} />}
      </DialogContent>
    </Dialog>
  );
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
            {name} is left off the Board's lists. Old Assignments keep the name.
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
