import { useEffect, useState, type FormEvent } from 'react';
import { Loader2, Plus } from 'lucide-react';
import type { Driver, NewOrder, Order } from '../../shared/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { createOrder, FieldErrors } from '@/lib/api';

const blank = (workDate: string): NewOrder => ({
  workDate,
  startTime: '',
  job: '',
  work: '',
  pickup: '',
  dropoff: '',
  driverId: '',
  truckNumber: '',
  notes: '',
});

/** "New Order": a form to add work for a day and assign a driver, with an optional truck number. */
export function NewOrderDialog({
  date,
  drivers,
  onCreated,
}: {
  date: string;
  drivers: Driver[] | null;
  onCreated: (order: Order) => void;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<NewOrder>(blank(date));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  // Each new order starts on the day the board shows.
  useEffect(() => {
    if (open) {
      setForm(blank(date));
      setErrors({});
      setFailed(false);
    }
  }, [open, date]);

  const set = <K extends keyof NewOrder>(field: K, value: NewOrder[K]) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors(({ [field]: _gone, ...rest }) => rest);
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFailed(false);
    try {
      const order = await createOrder(form);
      onCreated(order);
      setOpen(false);
    } catch (error) {
      if (error instanceof FieldErrors) setErrors(error.fields);
      else setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="lg" className="px-5">
          <Plus className="h-4 w-4" /> New Order
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display text-xl uppercase tracking-wide">New Order</DialogTitle>
          <DialogDescription>Add the work and assign a driver. The truck number is optional.</DialogDescription>
        </DialogHeader>

        <form id="new-order" onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Field id="workDate" label="Date" error={errors.workDate}>
            <Input id="workDate" type="date" required value={form.workDate} onChange={(e) => set('workDate', e.target.value)} />
          </Field>
          <Field id="startTime" label="Start time" optional error={errors.startTime}>
            <Input id="startTime" type="time" value={form.startTime ?? ''} onChange={(e) => set('startTime', e.target.value)} />
          </Field>
          <Field id="job" label="Job" error={errors.job} wide>
            <Input id="job" required placeholder="Job name or number" maxLength={120} value={form.job} onChange={(e) => set('job', e.target.value)} />
          </Field>
          <Field id="work" label="Work" error={errors.work} wide>
            <Textarea
              id="work"
              required
              rows={2}
              placeholder="What needs to be done, e.g. haul 10 loads of #57 stone"
              maxLength={500}
              value={form.work}
              onChange={(e) => set('work', e.target.value)}
            />
          </Field>
          <Field id="pickup" label="Pickup" optional error={errors.pickup}>
            <Input id="pickup" maxLength={200} value={form.pickup} onChange={(e) => set('pickup', e.target.value)} />
          </Field>
          <Field id="dropoff" label="Drop-off" optional error={errors.dropoff}>
            <Input id="dropoff" maxLength={200} value={form.dropoff} onChange={(e) => set('dropoff', e.target.value)} />
          </Field>
          <Field id="driverId" label="Driver" error={errors.driverId}>
            <Select value={form.driverId} onValueChange={(value) => set('driverId', value)} disabled={!drivers}>
              <SelectTrigger id="driverId" aria-label="Driver">
                <SelectValue placeholder={drivers ? 'Assign a driver' : 'Loading…'} />
              </SelectTrigger>
              <SelectContent>
                {drivers?.map((driver) => (
                  <SelectItem key={driver.id} value={driver.id}>
                    {driver.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field id="truckNumber" label="Truck number" optional error={errors.truckNumber}>
            <Input
              id="truckNumber"
              placeholder="e.g. T-101"
              maxLength={20}
              value={form.truckNumber ?? ''}
              onChange={(e) => set('truckNumber', e.target.value)}
            />
          </Field>
          <Field id="notes" label="Notes" optional error={errors.notes} wide>
            <Textarea id="notes" rows={2} maxLength={1000} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </Field>
        </form>

        {failed && <p className="text-sm text-destructive">Could not save the order. Try again.</p>}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="submit" form="new-order" disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Add order
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
  children: React.ReactNode;
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
