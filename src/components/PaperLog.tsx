import { useEffect, useId, useRef, useState } from 'react';
import { Camera, ImagePlus, Loader2 } from 'lucide-react';
import type { PaperLogAttacher, PaperLogPhoto, Truck } from '../../shared/types';
import { clockTime } from '../../shared/days';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { attachPaperLog, fetchPaperLogs, FieldErrors, paperLogPictureUrl, Refused, takeOffPaperLog } from '@/lib/api';
import { shrinkPhoto } from '@/lib/shrinkPhoto';

/** A photo the Worker has not kept yet: sending, or failed with Try again (the same id, the same picture). */
interface Sending {
  id: string;
  truckId: string;
  picture: Blob;
  failed: boolean;
}

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
  /** The photos as last read or attached, for a count beside the Paper log elsewhere. */
  onPhotos?: (photos: PaperLogPhoto[]) => void;
}

/**
 * A Driver's Paper log for one day (GLOSSARY.md): photos of his paper Daily
 * Truck Log, attached as a backup. The same component on the Driver page and,
 * in Dave's mode (attacher "dave"), on the Board. A Truck is picked (the
 * suggested one to begin with; another is one tap); one large "Photograph
 * Paper log" button opens the camera and "Choose a photo" the phone's photos.
 * The photo is shrunk on the phone and sent; one that fails to send stays
 * with Try again, which repeats the same attach, so it is kept once. A
 * refusal is shown as the Worker's plain message. The day's photos are listed
 * oldest first, "Truck 24 · attached 9:00", and open full size on a tap.
 * Nothing on the sheet is typed. In Dave's mode only, an opened photo has
 * Take off: it leaves the list (and the count) and is kept by the Worker; a
 * Driver can only add another.
 */
export function PaperLog({ date, driverId, attacher, trucks, suggestedTruckId, refreshes = 0, onPhotos }: PaperLogProps) {
  const [photos, setPhotos] = useState<PaperLogPhoto[] | null>(null);
  const [readFailed, setReadFailed] = useState(false);
  const [sending, setSending] = useState<Sending[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  /** The Truck tapped; null until one is, so a suggestion read later still applies. */
  const [tapped, setTapped] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  /** Take off on the opened photo: sending, or failed with its message. */
  const [takingOff, setTakingOff] = useState<'sending' | 'failed' | null>(null);
  const heading = useId();
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);
  const reported = useRef(onPhotos);
  reported.current = onPhotos;

  const truckId = tapped ?? suggestedTruckId;
  const truckNumber = (id: string) => trucks.find((t) => t.id === id)?.number ?? '?';

  useEffect(() => {
    let stale = false;
    fetchPaperLogs(date, driverId).then(
      (read) => {
        if (stale) return;
        setPhotos(read);
        reported.current?.(read);
        setReadFailed(false);
      },
      () => !stale && setReadFailed(true),
    );
    return () => {
      stale = true;
    };
  }, [date, driverId, refreshes]);

  const send = async (attempt: Sending) => {
    setMessage(null);
    setSending((all) => [...all.filter((s) => s.id !== attempt.id), { ...attempt, failed: false }]);
    try {
      const kept = await attachPaperLog({ id: attempt.id, date, truckId: attempt.truckId, driverId, attachedBy: attacher }, attempt.picture);
      setSending((all) => all.filter((s) => s.id !== attempt.id));
      setPhotos((current) => {
        const next = [...(current ?? []).filter((p) => p.id !== kept.id), kept];
        reported.current?.(next);
        return next;
      });
    } catch (error) {
      if (error instanceof FieldErrors || error instanceof Refused) {
        setSending((all) => all.filter((s) => s.id !== attempt.id));
        setMessage(error instanceof FieldErrors ? Object.values(error.fields)[0] ?? 'This photo was not kept. Take it again.' : error.message);
        return;
      }
      setSending((all) => all.map((s) => (s.id === attempt.id ? { ...s, failed: true } : s)));
    }
  };

  const picked = async (input: HTMLInputElement) => {
    const file = input.files?.[0];
    input.value = '';
    if (!file || !truckId) return;
    const picture = await shrinkPhoto(file);
    if (!picture) {
      setMessage('This photo could not be read. Take it again.');
      return;
    }
    void send({ id: crypto.randomUUID(), truckId, picture, failed: false });
  };

  const shown = open === null ? null : photos?.[open] ?? null;

  const view = (index: number | null) => {
    setTakingOff(null);
    setOpen(index);
  };

  /** Dave takes the opened photo off: it leaves the list once the Worker has it; a failure says so and leaves it. */
  const takeOff = async (photo: PaperLogPhoto) => {
    setTakingOff('sending');
    try {
      await takeOffPaperLog(photo.id);
    } catch {
      setTakingOff('failed');
      return;
    }
    view(null);
    setPhotos((current) => {
      const next = (current ?? []).filter((p) => p.id !== photo.id);
      reported.current?.(next);
      return next;
    });
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
      {photos?.length === 0 && sending.length === 0 && <p className="text-muted-foreground">No photos yet for this day.</p>}

      {photos && photos.length > 0 && (
        <ul aria-label="Paper log photos" className="space-y-2">
          {photos.map((photo, i) => (
            <li key={photo.id} className="flex items-center gap-3">
              <button
                type="button"
                aria-label={`Open photo ${i + 1} full size`}
                className="lift h-16 w-16 shrink-0 overflow-hidden rounded-md border bg-muted"
                onClick={() => view(i)}
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
            <li key={attempt.id} className="flex flex-wrap items-center gap-3">
              {attempt.failed ? (
                <>
                  <span className="text-destructive">Truck {truckNumber(attempt.truckId)} · not sent</span>
                  <Button type="button" variant="outline" className="h-11" onClick={() => send(attempt)}>
                    Try again
                  </Button>
                </>
              ) : (
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Sending the photo for Truck {truckNumber(attempt.truckId)}…
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
