import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Camera, ImagePlus, Loader2 } from 'lucide-react';
import type { PaperLogAttacher, PaperLogPhoto, Truck } from '../../shared/types';
import { clockTime, shortDate } from '../../shared/days';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { fetchPaperLogs, paperLogPictureUrl } from '@/lib/api';
import { paperLogMoment, refusalFor, sayRefused, sendPaperLog, takeOffPhoto, unsent, usePaperLogChanges, withChangesSince } from '@/lib/paperLogStore';
import { shrinkPhoto } from '@/lib/shrinkPhoto';

export interface PaperLogProps {
  /** The day the sheet is for: today or a past day (the page never offers a day to come). */
  date: string;
  /** Whose day it is. */
  driverId: string;
  /** Who attaches from here: the Driver on his page, Dave from the Board. */
  attacher: PaperLogAttacher;
  /** The Trucks he can pick, in the list's order. */
  trucks: Truck[];
  /** The Truck picked to begin with: that day's check-in Truck, else his usual one; null for none. */
  suggestedTruckId: string | null;
  /** Changes to read the photos again (the page came back into view). */
  refreshes?: number;
}

/**
 * A Driver's Paper log for one day (GLOSSARY.md): photos of his paper Daily
 * Truck Log, attached as a backup. The same component on the Driver page and,
 * in Dave's mode (attacher "dave"), on the Board. A Truck is picked (the
 * suggested one to begin with; another is one tap); one large "Photograph
 * Paper log" button opens the camera and "Choose a photo" the phone's photos.
 * The photo is shrunk on the phone and sent; one that fails to send stays
 * with Try again, which repeats the same attach, so it is kept once. Unsent
 * photos are held above this component (lib/paperLogStore.ts), so another
 * day, a closed dialog or the date moving on never loses one: each of this
 * Driver's shows here whatever day is open, with its day when it is another,
 * and leaving the page while one is unsent asks first. A refusal is shown as
 * the Worker's plain message. The day's photos are listed oldest first,
 * "Truck 24 · attached 9:00", and open full size on a tap; a read that
 * crossed an attach or a Take off keeps it.
 * Nothing on the sheet is typed. In Dave's mode only, an opened photo has
 * Take off: it leaves the list (and the count) and is kept by the Worker; a
 * Driver can only add another.
 */
export function PaperLog({ date, driverId, attacher, trucks, suggestedTruckId, refreshes = 0 }: PaperLogProps) {
  /** The photos as last read, and the moment that read started; null until the first answers. */
  const [read, setRead] = useState<{ photos: PaperLogPhoto[]; since: number } | null>(null);
  const [readFailed, setReadFailed] = useState(false);
  const moment = usePaperLogChanges();
  const photos = useMemo(() => (read ? withChangesSince(read.photos, read.since, date, driverId) : null), [read, moment, date, driverId]);
  const sending = unsent(driverId, attacher);
  const message = refusalFor(driverId, attacher);
  /** The Truck tapped; null until one is, so a suggestion read later still applies. */
  const [tapped, setTapped] = useState<string | null>(null);
  /** The photo opened full size, by id, so a read that moves the list never swaps it. */
  const [open, setOpen] = useState<string | null>(null);
  /** Take off on the opened photo: sending, or failed with its message. */
  const [takingOff, setTakingOff] = useState<'sending' | 'failed' | null>(null);
  const heading = useId();
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);

  const truckId = tapped ?? suggestedTruckId;
  const truckNumber = (id: string) => trucks.find((t) => t.id === id)?.number ?? '?';

  useEffect(() => {
    let stale = false;
    const since = paperLogMoment();
    fetchPaperLogs(date, driverId).then(
      (answer) => {
        if (stale) return;
        setRead({ photos: answer, since });
        setReadFailed(false);
      },
      () => !stale && setReadFailed(true),
    );
    return () => {
      stale = true;
    };
  }, [date, driverId, refreshes]);

  const picked = async (input: HTMLInputElement) => {
    const file = input.files?.[0];
    input.value = '';
    if (!file || !truckId) return;
    const picture = await shrinkPhoto(file);
    if (!picture) {
      sayRefused(driverId, attacher, 'This photo could not be read. Take it again.');
      return;
    }
    void sendPaperLog({ photo: { id: crypto.randomUUID(), date, truckId, driverId, attachedBy: attacher }, picture, failed: false });
  };

  const shown = open === null ? null : (photos?.find((p) => p.id === open) ?? null);

  const view = (id: string | null) => {
    setTakingOff(null);
    setOpen(id);
  };

  /** Dave takes the opened photo off: it leaves the list once the Worker has it; a failure says so and leaves it. */
  const takeOff = async (photo: PaperLogPhoto) => {
    setTakingOff('sending');
    try {
      await takeOffPhoto(photo);
    } catch {
      setTakingOff('failed');
      return;
    }
    view(null);
  };

  return (
    <section aria-labelledby={heading} className="animate-rise space-y-3 rounded-lg border bg-card p-4 shadow-sm">
      <h3 id={heading} className="font-display text-xl font-semibold uppercase tracking-wide">
        Paper log
      </h3>
      <p className="text-muted-foreground">A photo of the paper Daily Truck Log, kept as a backup.</p>

      {trucks.length > 0 && (
        <div role="group" aria-label="Truck" className="grid grid-cols-3 gap-2">
          {trucks.map((truck) => (
            <Button
              key={truck.id}
              type="button"
              size="lg"
              className="h-12 px-2 text-lg"
              variant={truck.id === truckId ? 'default' : 'outline'}
              aria-pressed={truck.id === truckId}
              onClick={() => setTapped(truck.id)}
            >
              Truck {truck.number}
            </Button>
          ))}
        </div>
      )}
      {!truckId && <p className="text-muted-foreground">Tap the Truck this sheet is for.</p>}

      <div className="flex flex-col gap-2">
        <Button type="button" size="lg" className="h-14 text-xl" disabled={!truckId} onClick={() => camera.current?.click()}>
          <Camera aria-hidden className="h-6 w-6" /> Photograph Paper log
        </Button>
        <Button type="button" size="lg" variant="outline" className="h-12 text-lg" disabled={!truckId} onClick={() => library.current?.click()}>
          <ImagePlus aria-hidden className="h-5 w-5" /> Choose a photo
        </Button>
        {/* Hidden pickers behind the two buttons: the camera, and the phone's photos. */}
        <input ref={camera} type="file" accept="image/*" capture="environment" aria-label="Photo from the camera" className="sr-only" tabIndex={-1} disabled={!truckId} onChange={(e) => picked(e.currentTarget)} />
        <input ref={library} type="file" accept="image/*" aria-label="Photo from your photos" className="sr-only" tabIndex={-1} disabled={!truckId} onChange={(e) => picked(e.currentTarget)} />
      </div>

      {message && (
        <p role="alert" className="text-destructive">
          {message}
        </p>
      )}

      {readFailed && photos === null && <p className="text-destructive">Could not load the photos. It tries again when you come back to the page.</p>}
      {photos === null && !readFailed && (
        <p className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading photos…
        </p>
      )}
      {photos?.length === 0 && !sending.some((s) => s.photo.date === date) && <p className="text-muted-foreground">No photos yet for this day.</p>}

      {photos && photos.length > 0 && (
        <ul aria-label="Paper log photos" className="space-y-2">
          {photos.map((photo, i) => (
            <li key={photo.id} className="flex items-center gap-3">
              <button
                type="button"
                aria-label={`Open photo ${i + 1} full size`}
                className="lift h-16 w-16 shrink-0 overflow-hidden rounded-md border bg-muted"
                onClick={() => view(photo.id)}
              >
                <img src={paperLogPictureUrl(photo.id)} alt={`Paper log photo ${i + 1}`} className="h-full w-full object-cover" />
              </button>
              <span className="text-lg">
                Truck {photo.truckNumber} · attached {clockTime(photo.attachedAt)}
                {photo.attachedBy === 'dave' && ' · by Dave'}
              </span>
            </li>
          ))}
        </ul>
      )}

      {sending.length > 0 && (
        <ul aria-label="Photos sending" className="space-y-2">
          {sending.map((attempt) => (
            <li key={attempt.photo.id} className="flex flex-wrap items-center gap-3">
              {attempt.failed ? (
                <>
                  <span className="text-destructive">
                    Truck {truckNumber(attempt.photo.truckId)}
                    {attempt.photo.date !== date && ` · ${shortDate(attempt.photo.date)}`} · not sent
                  </span>
                  <Button type="button" variant="outline" className="h-11" onClick={() => sendPaperLog(attempt)}>
                    Try again
                  </Button>
                </>
              ) : (
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Sending the photo for Truck {truckNumber(attempt.photo.truckId)}
                  {attempt.photo.date !== date && ` · ${shortDate(attempt.photo.date)}`}…
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={shown !== null} onOpenChange={(isOpen) => !isOpen && view(null)}>
        {shown && (
          <DialogContent className="max-h-[95vh] max-w-3xl overflow-auto">
            <DialogHeader>
              <DialogTitle>Paper log · Truck {shown.truckNumber}</DialogTitle>
              <DialogDescription>
                Attached {clockTime(shown.attachedAt)}
                {shown.attachedBy === 'dave' ? ' by Dave' : ` by ${shown.driverName}`}
              </DialogDescription>
            </DialogHeader>
            <img src={paperLogPictureUrl(shown.id)} alt={`Paper log for Truck ${shown.truckNumber}, full size`} className="h-auto w-full" />
            {attacher === 'dave' && (
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" variant="outline" className="h-11" disabled={takingOff === 'sending'} onClick={() => takeOff(shown)}>
                  {takingOff === 'sending' && <Loader2 className="h-4 w-4 animate-spin" />} Take off
                </Button>
                <span className="text-sm text-muted-foreground">Hides a photo of the wrong sheet. It is kept.</span>
                {takingOff === 'failed' && (
                  <p role="alert" className="w-full text-destructive">
                    This photo was not taken off. Try again.
                  </p>
                )}
              </div>
            )}
          </DialogContent>
        )}
      </Dialog>
    </section>
  );
}
