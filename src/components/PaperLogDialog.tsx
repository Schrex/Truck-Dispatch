import type { Truck } from '../../shared/types';
import { shortDate } from '../../shared/days';
import { PaperLog } from '@/components/PaperLog';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/**
 * A Driver's Paper log for one day, opened from his lane on the Board: the
 * same Paper log component as on his page (components/PaperLog.tsx), in
 * Dave's mode, so a photo attached here is stored as attached by Dave. The
 * Truck suggested is the one the Driver checked in to that day, else his
 * usual Truck. Past days are allowed here, a deliberate exception to their
 * being read-only for Assignments (ADR 0004, as ADR 0007).
 */
export function PaperLogDialog({
  date,
  driver,
  trucks,
  checkInTruckId,
  refreshes,
  onClose,
}: {
  date: string;
  driver: { id: string; name: string; defaultTruckId: string | null };
  /** Every Truck, removed ones too; only active ones are offered, besides the suggested one. */
  trucks: Truck[];
  /** The Truck he checked in to that day; null for none (or while not read). */
  checkInTruckId: string | null;
  /** Changes to read the photos again (the Board came back into view). */
  refreshes: number;
  onClose: () => void;
}) {
  const suggestedTruckId = checkInTruckId ?? driver.defaultTruckId;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Paper log · {driver.name}</DialogTitle>
          <DialogDescription>{shortDate(date)}</DialogDescription>
        </DialogHeader>
        <PaperLog
          date={date}
          driverId={driver.id}
          attacher="dave"
          trucks={trucks.filter((t) => t.active || t.id === suggestedTruckId)}
          suggestedTruckId={suggestedTruckId}
          refreshes={refreshes}
        />
      </DialogContent>
    </Dialog>
  );
}
