import { useEffect, useState, type FormEvent } from 'react';
import { Copy, Loader2, Trash2 } from 'lucide-react';
import type { Assignment, Driver, Foreman, Material, Place, Truck } from '../../shared/types';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/Field';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ListPicker } from '@/components/ListPicker';
import { toast } from '@/components/ui/sonner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { addAssignment, changeAssignment, changesOf, deleteAssignment, fieldsOf, FieldErrors, Refused } from '@/lib/api';
import { choicesOf } from '@/lib/lists';

interface Form {
  date: string;
  driverId: string | null;
  truckId: string | null;
  fromPlaceId: string | null;
  toPlaceId: string | null;
  materialId: string | null;
  foremanId: string | null;
  note: string;
}

const EMPTY = { driverId: null, truckId: null, fromPlaceId: null, toPlaceId: null, materialId: null, foremanId: null, note: '' };

/**
 * An existing Assignment, open while `editing` is set: every field can be
 * changed or cleared, and it can be deleted or duplicated to another Driver,
 * but its day is fixed, and saving sends only the fields that changed. The
 * Board opens it by setting `editing` and closes it through onClose. New
 * Assignments are added from a lane's composer, not here.
 */
export function AssignmentDialog({
  date,
  drivers,
  trucks,
  places,
  materials,
  foremen,
  onSaved,
  editing,
  onClose,
  onDeleted,
}: {
  date: string;
  /** Every entry of each list, inactive ones included: the pickers leave those out unless already chosen. */
  drivers: Driver[] | null;
  trucks: Truck[] | null;
  places: Place[] | null;
  materials: Material[] | null;
  foremen: Foreman[] | null;
  onSaved: (assignment: Assignment) => void;
  editing: Assignment | null;
  onClose: () => void;
  onDeleted?: (assignment: Assignment) => void;
}) {
  const open = editing != null;
  const setOpen = (value: boolean) => !value && onClose();
  const [form, setForm] = useState<Form>({ date, ...EMPTY });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [duplicateTo, setDuplicateTo] = useState('');

  // The Assignment opens as it was saved.
  useEffect(() => {
    if (editing) {
      setForm({ ...fieldsOf(editing), note: editing.note ?? '' });
      setErrors({});
      setFailed(null);
      setConfirmDelete(false);
      setDuplicateTo('');
    }
  }, [editing]);

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

  /** A second Assignment with the same saved fields, note included, for another Driver on the same day. */
  async function duplicate() {
    if (!editing || !duplicateTo) return;
    setSaving(true);
    setFailed(null);
    try {
      const copy = await addAssignment({ ...fieldsOf(editing), driverId: duplicateTo });
      toast.success(`Duplicated to ${copy.driverName ?? 'another Driver'}`);
      onSaved(copy);
      setOpen(false);
    } catch (error) {
      failWith(error, 'duplicate');
    } finally {
      setSaving(false);
    }
  }

  const set = <K extends keyof Form>(field: K, value: Form[K]) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors(({ [field]: _gone, ...rest }) => rest);
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    setSaving(true);
    setFailed(null);
    try {
      const { date: _day, ...edited } = form;
      const changes = changesOf(editing, edited);
      if (Object.keys(changes).length === 0) {
        setOpen(false);
        return;
      }
      const assignment = await changeAssignment(editing.id, changes);
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display text-xl uppercase tracking-wide">Edit Assignment</DialogTitle>
          <DialogDescription>
            Change any field, clear one, move it to another Driver, or delete it. It stays on its day.
          </DialogDescription>
        </DialogHeader>

        <form id="assignment" onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Field id="date" label="Date" error={errors.date}>
            <Input id="date" type="date" required disabled value={form.date} onChange={(e) => set('date', e.target.value)} />
          </Field>
          <Field id="driverId" label="Driver" optional error={errors.driverId}>
            <ListPicker id="driverId" label="Driver" empty="No Driver" choices={choicesOf('drivers', drivers)} value={form.driverId} onChange={(value) => set('driverId', value)} />
          </Field>
          {/* No Truck means the Driver takes his own: pick one only when the work needs a certain Truck. */}
          <Field id="truckId" label="Truck" optional error={errors.truckId}>
            <ListPicker id="truckId" label="Truck" empty="His own" choices={choicesOf('trucks', trucks)} value={form.truckId} onChange={(value) => set('truckId', value)} />
          </Field>
          <Field id="fromPlaceId" label="From Place" optional error={errors.fromPlaceId}>
            <ListPicker id="fromPlaceId" label="From Place" empty="No From Place" choices={choicesOf('places', places)} value={form.fromPlaceId} onChange={(value) => set('fromPlaceId', value)} />
          </Field>
          <Field id="toPlaceId" label="To Place" optional error={errors.toPlaceId}>
            <ListPicker id="toPlaceId" label="To Place" empty="No To Place" choices={choicesOf('places', places)} value={form.toPlaceId} onChange={(value) => set('toPlaceId', value)} />
          </Field>
          <Field id="materialId" label="Material" optional error={errors.materialId}>
            <ListPicker id="materialId" label="Material" empty="No Material" choices={choicesOf('materials', materials)} value={form.materialId} onChange={(value) => set('materialId', value)} />
          </Field>
          <Field id="foremanId" label="Foreman" optional error={errors.foremanId}>
            <ListPicker id="foremanId" label="Foreman" empty="No Foreman" choices={choicesOf('foremen', foremen)} value={form.foremanId} onChange={(value) => set('foremanId', value)} />
          </Field>
          <Field id="note" label="Note" optional error={errors.note} wide>
            <Textarea id="note" rows={3} maxLength={1000} value={form.note} onChange={(e) => set('note', e.target.value)} />
          </Field>
        </form>

        {editing && (
          <form
            className="flex items-end gap-2 border-t pt-4"
            onSubmit={(event) => {
              event.preventDefault();
              void duplicate();
            }}
          >
            <div className="flex-1 space-y-2">
              <Label htmlFor="duplicateTo">Duplicate to</Label>
              <Select value={duplicateTo} onValueChange={setDuplicateTo} disabled={!drivers}>
                <SelectTrigger id="duplicateTo" aria-label="Duplicate to">
                  <SelectValue placeholder="Another Driver" />
                </SelectTrigger>
                <SelectContent>
                  {drivers
                    ?.filter((driver) => driver.active && driver.id !== editing.driverId)
                    .map((driver) => (
                      <SelectItem key={driver.id} value={driver.id}>
                        {driver.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" variant="outline" disabled={saving || !duplicateTo}>
              <Copy className="h-4 w-4" /> Duplicate
            </Button>
          </form>
        )}

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
