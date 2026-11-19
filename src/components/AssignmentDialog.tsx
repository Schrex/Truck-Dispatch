import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Loader2, Plus } from 'lucide-react';
import type { Assignment, Driver } from '../../shared/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/components/ui/sonner';
import { Textarea } from '@/components/ui/textarea';
import { addAssignment, FieldErrors } from '@/lib/api';

/** The picker's empty choice. Radix Select cannot use '' as a value. */
const NO_DRIVER = 'none';

interface Form {
  date: string;
  driverId: string;
  note: string;
}

/** "Add Assignment": only the date is required; the Driver and a note are optional. */
export function AssignmentDialog({
  date,
  drivers,
  onSaved,
}: {
  date: string;
  drivers: Driver[] | null;
  onSaved: (assignment: Assignment) => void;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>({ date, driverId: NO_DRIVER, note: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  // Each new Assignment starts on the day the Board shows.
  useEffect(() => {
    if (open) {
      setForm({ date, driverId: NO_DRIVER, note: '' });
      setErrors({});
      setFailed(false);
    }
  }, [open, date]);

  const set = <K extends keyof Form>(field: K, value: Form[K]) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors(({ [field]: _gone, ...rest }) => rest);
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFailed(false);
    try {
      const assignment = await addAssignment({
        date: form.date,
        driverId: form.driverId === NO_DRIVER ? null : form.driverId,
        note: form.note,
      });
      toast.success('Assignment saved');
      onSaved(assignment);
      setOpen(false);
    } catch (error) {
      if (error instanceof FieldErrors) {
        setErrors(error.fields);
      } else {
        setFailed(true);
        toast.error('Could not save the Assignment');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="lg" className="px-5">
          <Plus className="h-4 w-4" /> Add Assignment
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display text-xl uppercase tracking-wide">Add Assignment</DialogTitle>
          <DialogDescription>Only the date is needed. Fill in what you know now and the rest later.</DialogDescription>
        </DialogHeader>

        <form id="assignment" onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Field id="date" label="Date" error={errors.date}>
            <Input id="date" type="date" required value={form.date} onChange={(e) => set('date', e.target.value)} />
          </Field>
          <Field id="driverId" label="Driver" optional error={errors.driverId}>
            <Select value={form.driverId} onValueChange={(value) => set('driverId', value)} disabled={!drivers}>
              <SelectTrigger id="driverId" aria-label="Driver">
                <SelectValue placeholder={drivers ? 'No Driver' : 'Loading…'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_DRIVER}>No Driver</SelectItem>
                {drivers?.map((driver) => (
                  <SelectItem key={driver.id} value={driver.id}>
                    {driver.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field id="note" label="Note" optional error={errors.note} wide>
            <Textarea id="note" rows={3} maxLength={1000} value={form.note} onChange={(e) => set('note', e.target.value)} />
          </Field>
        </form>

        {failed && <p className="text-sm text-destructive">Could not save the Assignment. Try again.</p>}

        <DialogFooter>
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

function Field({
  id,
  label,
  optional,
  error,
  wide,
  children,
}: {
  id: string;
  label: string;
  optional?: boolean;
  error?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={wide ? 'space-y-2 sm:col-span-2' : 'space-y-2'}>
      <Label htmlFor={id}>
        {label}
        {optional && <span className="ml-1 font-normal text-muted-foreground">(optional)</span>}
      </Label>
      {children}
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
