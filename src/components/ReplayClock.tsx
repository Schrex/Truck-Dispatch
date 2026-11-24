import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { Pause, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { DAY_END, minuteClock } from '../../shared/days';

/** Play moves the clock in the steps the Worker pulls Fleet (every 10 minutes). */
const PULL_MINUTES = 10;
/** Where Play starts when the clock is at the end of the day: before the Truck leaves the shop. */
const PLAY_FROM = 4 * 60;

/**
 * The replay clock, in minutes since midnight: a slider to drag through the
 * day, and Play to move it on in 10-minute steps until the end of the day.
 * The Simulation and the Fleet imports page share it.
 */
export function ReplayClock({ clock, onClock, className }: { clock: number; onClock: Dispatch<SetStateAction<number>>; className?: string }) {
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      onClock((c) => {
        const next = Math.min(DAY_END, c + PULL_MINUTES);
        if (next === DAY_END) setPlaying(false);
        return next;
      });
    }, 600);
    return () => window.clearInterval(timer);
  }, [playing, onClock]);

  return (
    <div className={cn('flex flex-wrap items-center gap-3', className)}>
      <Button
        size="icon"
        variant="outline"
        className="shrink-0"
        aria-label={playing ? 'Pause' : 'Play the day'}
        onClick={() => {
          if (!playing && clock === DAY_END) onClock(PLAY_FROM);
          setPlaying((p) => !p);
        }}
      >
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </Button>
      <input
        type="range"
        aria-label="Clock"
        min={0}
        max={DAY_END}
        step={1}
        value={clock}
        onChange={(e) => onClock(Number(e.target.value))}
        className="w-full max-w-md accent-primary"
      />
      <p className="text-sm">
        <strong className="font-display text-lg">{clock === DAY_END ? 'end of day' : minuteClock(clock)}</strong>
      </p>
    </div>
  );
}
