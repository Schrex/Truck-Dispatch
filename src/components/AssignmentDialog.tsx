import { useEffect, useState, type FormEvent } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import type { Assignment, Driver, Truck } from '../../shared/types';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/Field';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ListPicker } from '@/components/ListPicker';
import { toast } from '@/components/ui/sonner';
import { Textarea } from '@/components/ui/textarea';
import { addAssignment, changeAssignment, deleteAssignment, FieldErrors, Refused } from '@/lib/api';
import { choicesOf } from '@/lib/lists';

interface Form {
  date: string;
  driverId: string | null;
  truckId: string | null;
  note: string;
}

/**
 * "Add Assignment" (with its own button), or, given `editing`, the same dialog
 * for an existing Assignment: every field can be changed or cleared, and it
 * can be deleted. Only the date is required. In edit mode the Board opens it by
 * setting `editing` and closes it through onClose.
 */
export function AssignmentDialog({
  date,
  drivers,
  trucks,
  onSaved,
  editing,
  onClose,
  onDeleted,
}: {
  date: string;
  /** Every Driver and Truck, inactive ones included: the pickers leave those out unless already chosen. */
  drivers: Driver[] | null;
  trucks: Truck[] | null;
  onSaved: (assignment: Assignment) => void;
  editing?: Assignment | null;
  onClose?: () => void;
  onDeleted?: (assignment: Assignment) => void;
}) {
  const editMode = editing !== undefined;
  const [adding, setAdding] = useState(false);
  const open = editMode ? editing != null : adding;
  const setOpen = (value: boolean) => (editMode ? !value && onClose?.() : setAdding(value));
  const [form, setForm] = useState<Form>({ date, driverId: null, truckId: null, note: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // A new Assignment starts on the day the Board shows; an existing one as it was saved.
  useEffect(() => {
    if (open) {
      setForm(
        editing
          ? { date: editing.date, driverId: editing.driverId, truckId: editing.truckId, note: editing.note ?? '' }
          : { date, driverId: null, truckId: null, note: '' },
      );
      setErrors({});
      setFailed(null);
      setConfirmDelete(false);
    }
  }, [open, date, editing]);

  function failWith(error: unknown, what: string) {
    if (error instanceof FieldErrors) {
      setErrors(error.fields);
      return;
    }
    const message = error instanceof Refused ? error.message : `Could not ${what} the Assignment. Try again.`;
    setFailed(message);
    toast.error(`Could not ${what} the Assignment`);
  }

  async function remove() {
    if (!editing) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setSaving(true);
    setFailed(null);
    try {
      await deleteAssignment(editing.id);
      toast.success('Assignment deleted');
      onDeleted?.(editing);
      setOpen(false);
    } catch (error) {
      failWith(error, 'delete');
    } finally {
      setSaving(false);
    }
  }

  const set = <K extends keyof Form>(field: K, value: Form[K]) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors(({ [field]: _gone, ...rest }) => rest);
  };

  /** Picking a Driver fills an empty Truck with their usual Truck, if it is still in use; a chosen Truck is left alone. */
  const pickDriver = (driverId: string | null) => {
    set('driverId', driverId);
    if (form.truckId) return;
    const usual = drivers?.find((driver) => driver.id === driverId)?.defaultTruckId;
    if (usual && trucks?.some((truck) => truck.id === usual && truck.active)) set('truckId', usual);
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFailed(null);
    try {
      const fields = {
        date: form.date,
        driverId: form.driverId,
        truckId: form.truckId,
        note: form.note,
      };
      const assignment = editing ? await changeAssignment(editing.id, fields) : await addAssignment(fields);
      toast.success('Assignment saved');
      onSaved(assignment);
      setOpen(false);
    } catch (error) {
      failWith(error, 'save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!editMode && (
        <DialogTrigger asChild>
          <Button size="lg" className="px-5">
            <Plus className="h-4 w-4" /> Add Assignment
          </Button>
        </DialogTrigger>
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display text-xl uppercase tracking-wide">{editing ? 'Edit Assignment' : 'Add Assignment'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'Change any field, clear one, move it to another Driver or day, or delete it.'
              : 'Only the date is needed. Fill in what you know now and the rest later.'}
          </DialogDescription>
        </DialogHeader>

        <form id="assignment" onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Field id="date" label="Date" error={errors.date}>
            <Input id="date" type="date" required value={form.date} onChange={(e) => set('date', e.target.value)} />
          </Field>
          <Field id="driverId" label="Driver" optional error={errors.driverId}>
            <ListPicker id="driverId" label="Driver" empty="No Driver" choices={choicesOf('drivers', drivers)} value={form.driverId} onChange={pickDriver} />
          </Field>
          <Field id="truckId" label="Truck" optional error={errors.truckId}>
            <ListPicker id="truckId" label="Truck" empty="No Truck" choices={choicesOf('trucks', trucks)} value={form.truckId} onChange={(value) => set('truckId', value)} />
          </Field>
          <Field id="note" label="Note" optional error={errors.note} wide>
            <Textarea id="note" rows={3} maxLength={1000} value={form.note} onChange={(e) => set('note', e.target.value)} />
          </Field>
        </form>

        {failed && <p className="text-sm text-destructive">{failed}</p>}

        <DialogFooter>
          {editing && (
            <Button type="button" variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive sm:mr-auto" disabled={saving} onClick={remove}>
              <Trash2 className="h-4 w-4" /> {confirmDelete ? 'Delete for good' : 'Delete'}
            </Button>
          )}
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="submit" form="assignment" disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save Assignment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
