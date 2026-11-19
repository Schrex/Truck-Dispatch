import { useEffect, useState, type FormEvent } from 'react';
import { Loader2, Pencil, Plus } from 'lucide-react';
import type { ListName, Lists } from '../../shared/types';
import { Field } from '@/components/Field';
import { ListPicker } from '@/components/ListPicker';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/sonner';
import { Switch } from '@/components/ui/switch';
import { addEntry, changeEntry, FieldErrors, fetchList } from '@/lib/api';
import { choicesOf, displayName } from '@/lib/lists';

type Key<L extends ListName> = Exclude<keyof Lists[L], 'id' | 'active'> & string;

/** An optional field of a list: free text, or an entry picked from another list. */
export type ListField<L extends ListName> =
  | { key: Key<L>; label: string; kind: 'text' }
  | { key: Key<L>; label: string; kind: 'pick'; list: ListName; empty: string };

/**
 * One Settings tab, declared by its fields. Adding a list to Settings is
 * declaring one of these (SettingsPage.tsx); the API side is worker/src/lists.ts.
 */
export interface ListTabSpec<L extends ListName> {
  list: L;
  /** The tab's title, e.g. "Trucks". */
  title: string;
  /** One entry, e.g. "Truck". */
  noun: string;
  /** The display name: required and unique in the list, ignoring case. */
  name: { key: Key<L>; label: string };
  fields: ListField<L>[];
}

type Row = Record<string, unknown> & { id: string; active: boolean };
type Form = Record<string, string | null>;

/** Every entry, inactive ones marked, with add, edit and an active switch. There is no delete. */
export function ListTab<L extends ListName>({ spec }: { spec: ListTabSpec<L> }) {
  const [entries, setEntries] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [others, setOthers] = useState<Partial<Record<ListName, Row[]>>>({});
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const picked = [...new Set(spec.fields.flatMap((f) => (f.kind === 'pick' ? [f.list] : [])))];

  useEffect(() => {
    fetchList(spec.list, { includeInactive: true }).then((list) => setEntries(list as unknown as Row[]), () => setFailed(true));
    for (const list of picked) {
      fetchList(list, { includeInactive: true }).then((rows) => setOthers((current) => ({ ...current, [list]: rows as unknown as Row[] })));
    }
    // The spec is declared once and never changes.
  }, [spec.list]);

  const name = (list: ListName, id: unknown) => {
    const entry = others[list]?.find((e) => e.id === id);
    return entry ? displayName(list, entry as never) : null;
  };
  const details = (entry: Row) =>
    spec.fields.flatMap((field) => {
      const value = field.kind === 'pick' ? name(field.list, entry[field.key]) : (entry[field.key] as string | null);
      return value ? [`${field.label} ${value}`] : [];
    });

  const put = (saved: Row) =>
    setEntries((current) => {
      const rest = (current ?? []).filter((e) => e.id !== saved.id);
      const label = (e: Row) => String(e[spec.name.key]);
      return [...rest, saved].sort((a, b) => label(a).localeCompare(label(b), undefined, { sensitivity: 'base' }));
    });

  async function setActive(entry: Row, active: boolean) {
    try {
      put((await changeEntry(spec.list, entry.id, { active } as never)) as unknown as Row);
      toast.success(`${spec.noun} ${String(entry[spec.name.key])} made ${active ? 'active' : 'inactive'}`);
    } catch {
      toast.error(`Could not change the ${spec.noun}`);
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Inactive {spec.title} stay here and on old Assignments, but are left out of the Board's pickers.</p>
        <Button onClick={() => setEditing('new')}>
          <Plus className="h-4 w-4" /> Add {spec.noun}
        </Button>
      </div>
      {failed && <p className="text-sm text-destructive">Could not load the {spec.title}.</p>}
      {!entries && !failed && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading {spec.title}…
        </p>
      )}
      {entries?.length === 0 && <p className="rounded-lg border border-dashed bg-background py-10 text-center text-sm text-muted-foreground">No {spec.title} yet.</p>}
      {entries && entries.length > 0 && (
        <ul className="divide-y rounded-lg border bg-background">
          {entries.map((entry) => {
            const label = String(entry[spec.name.key]);
            return (
              <li key={entry.id} aria-label={label} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className={entry.active ? 'font-medium' : 'font-medium text-muted-foreground'}>
                    {label}
                    {!entry.active && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-normal uppercase tracking-wide text-muted-foreground">Inactive</span>}
                  </p>
                  {details(entry).length > 0 && <p className="text-sm text-muted-foreground">{details(entry).join(' · ')}</p>}
                </div>
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Switch aria-label="Active" checked={entry.active} onCheckedChange={(active) => setActive(entry, active)} />
                  <span aria-hidden>Active</span>
                </label>
                <Button variant="outline" size="sm" aria-label="Edit" onClick={() => setEditing(entry)}>
                  <Pencil className="h-4 w-4" /> Edit
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <EntryDialog spec={spec} entry={editing} others={others} onClose={() => setEditing(null)} onSaved={put} />
    </section>
  );
}

/** Add or edit one entry: its display name and its other fields. */
function EntryDialog<L extends ListName>({
  spec,
  entry,
  others,
  onClose,
  onSaved,
}: {
  spec: ListTabSpec<L>;
  entry: Row | 'new' | null;
  others: Partial<Record<ListName, Row[]>>;
  onClose: () => void;
  onSaved: (entry: Row) => void;
}) {
  const keys = [spec.name.key, ...spec.fields.map((f) => f.key)];
  const [form, setForm] = useState<Form>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const existing = entry && entry !== 'new' ? entry : null;
  const title = `${existing ? 'Edit' : 'Add'} ${spec.noun}`;

  useEffect(() => {
    if (!entry) return;
    setForm(Object.fromEntries(keys.map((key) => [key, existing ? ((existing[key] as string | null) ?? null) : null])));
    setErrors({});
    // keys come from the spec, which never changes.
  }, [entry]);

  const set = (key: string, value: string | null) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors(({ [key]: _gone, ...rest }) => rest);
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const fields = Object.fromEntries(keys.map((key) => [key, form[key] ?? null])) as never;
      const saved = existing ? await changeEntry(spec.list, existing.id, fields) : await addEntry(spec.list, fields);
      toast.success(`${spec.noun} saved`);
      onSaved(saved as unknown as Row);
      onClose();
    } catch (error) {
      if (error instanceof FieldErrors) setErrors(error.fields);
      else toast.error(`Could not save the ${spec.noun}`);
    } finally {
      setSaving(false);
    }
  }

  const formId = `${spec.list}-entry`;
  return (
    <Dialog open={entry !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display text-xl uppercase tracking-wide">{title}</DialogTitle>
          <DialogDescription>
            {existing ? `Renaming changes the name on every Assignment that uses this ${spec.noun}.` : `Add a ${spec.noun} to pick on the Board.`}
          </DialogDescription>
        </DialogHeader>
        <form id={formId} onSubmit={submit} className="grid gap-4" noValidate>
          <Field id={spec.name.key} label={spec.name.label} error={errors[spec.name.key]}>
            <Input id={spec.name.key} required value={form[spec.name.key] ?? ''} onChange={(e) => set(spec.name.key, e.target.value)} />
          </Field>
          {spec.fields.map((field) => (
            <Field key={field.key} id={field.key} label={field.label} optional error={errors[field.key]}>
              {field.kind === 'text' ? (
                <Input id={field.key} value={form[field.key] ?? ''} onChange={(e) => set(field.key, e.target.value)} />
              ) : (
                <ListPicker
                  id={field.key}
                  label={field.label}
                  empty={field.empty}
                  choices={choicesOf(field.list, (others[field.list] as never) ?? null)}
                  value={form[field.key] ?? null}
                  onChange={(value) => set(field.key, value)}
                />
              )}
            </Field>
          ))}
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save {spec.noun}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
