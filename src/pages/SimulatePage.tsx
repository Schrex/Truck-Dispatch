import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardList, Pause, Play } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Lanes } from '@/components/Lanes';
import { PageHeader } from '@/components/PageHeader';
import { TruckLog } from '@/components/TruckLog';
import { TruckLogAssignments, unplannedLine } from '@/components/TruckLogAssignments';
import { Button } from '@/components/ui/button';
import { DriverView } from '@/simulate/DriverView';
import { TripLog } from '@/simulate/TripLog';
import { UnplannedAnswerFlow } from '@/simulate/UnplannedAnswerFlow';
import type { UnplannedAnswer } from '@/simulate/answers';
import { REAL_DAY } from '@/simulate/realDay';
import { DAY_END, clockTime, simulateAt } from '@/simulate/simulate';

/** Play moves the clock in the steps the Worker pulls Fleet (every 10 minutes). */
const PULL_MINUTES = 10;
/** Where Play starts when the clock is at the end of the day: before the Truck leaves the shop. */
const PLAY_FROM = 4 * 60;

/**
 * The simulation: Truck 55 (MCK-55-17), driven by Randy on Mon 16 Nov 2026,
 * on the real HCSS Fleet data. A clock (drag it, or play the day in 10-minute
 * steps) and a scenario picker (Dave's Assignments as planned, the other way
 * round, the reroute at 11:20), then the Scheduler view (Randy's lane on the
 * real board lanes) and the Driver view (his Today on the real Driver cards)
 * and the Truck log (the paper Daily Truck Log: header, one column per
 * Assignment, and the Unplanned work), each with what the
 * Trip builder works out at the clock's time. Dave answers the Unplanned work
 * from the lane or the Truck log; the answers are held here, in memory, and
 * a new scenario starts with none. Nothing is saved and the Worker is not asked.
 */
export function SimulatePage() {
  const [scenarioId, setScenarioId] = useState(REAL_DAY.scenarios[0].id);
  const [clock, setClock] = useState(DAY_END);
  const [playing, setPlaying] = useState(false);
  const [answers, setAnswers] = useState<UnplannedAnswer[]>([]);
  /** The piece of Unplanned work being answered (its id); null when none is. */
  const [answering, setAnswering] = useState<string | null>(null);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      setClock((c) => {
        const next = Math.min(DAY_END, c + PULL_MINUTES);
        if (next === DAY_END) setPlaying(false);
        return next;
      });
    }, 600);
    return () => window.clearInterval(timer);
  }, [playing]);

  const scenario = REAL_DAY.scenarios.find((s) => s.id === scenarioId) ?? REAL_DAY.scenarios[0];
  const day = useMemo(() => simulateAt(scenario, clock, answers), [scenario, clock, answers]);
  const answer = useCallback((unplannedId: string) => setAnswering(unplannedId), []);
  const work = day.tripDay.unplanned.find((w) => w.id === answering);
  const shown = day.truckLog.unplanned.find((w) => w.id === answering);

  return (
    <div className="min-h-screen bg-surface">
      <PageHeader title="Simulation" subtitle={`Truck ${REAL_DAY.truck.number} (${REAL_DAY.truck.hcssCode}) · ${REAL_DAY.driver.name} · Mon 16 Nov 2026`}>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Dave’s Assignments</span>
          <select
            aria-label="Scenario"
            value={scenario.id}
            onChange={(e) => {
              setScenarioId(e.target.value);
              // The answers were to this scenario's Unplanned work: a new scenario starts with none.
              setAnswers([]);
              setAnswering(null);
            }}
            className="h-11 rounded-md border border-input bg-background px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {REAL_DAY.scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        {/* As from Settings: an outline button named for where it goes (docs/design/ui-standards.md). */}
        <Button asChild variant="outline" size="lg" className="px-5">
          <Link to="/">
            <ClipboardList className="h-4 w-4" /> Board
          </Link>
        </Button>
      </PageHeader>

      <div className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="container flex flex-wrap items-center gap-3 py-3">
          <Button
            size="icon"
            variant="outline"
            className="shrink-0"
            aria-label={playing ? 'Pause' : 'Play the day'}
            onClick={() => {
              if (!playing && clock === DAY_END) setClock(PLAY_FROM);
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
            onChange={(e) => setClock(Number(e.target.value))}
            className="w-full max-w-md accent-primary"
          />
          <p className="text-sm">
            <strong className="font-display text-lg">{clock === DAY_END ? 'end of day' : clockTime(clock)}</strong>
          </p>
        </div>
      </div>

      <main className="container space-y-6 py-6">
        <div className="grid gap-6 xl:grid-cols-2">
          <div className="min-w-0 space-y-6">
            <section aria-label="Scheduler view" className="space-y-3">
              <h2 className="font-display text-xl font-semibold uppercase tracking-wide">Scheduler view</h2>
              <Lanes
                assignments={day.assignments}
                drivers={[REAL_DAY.driver]}
                trucks={[REAL_DAY.truck]}
                // Randy drove Truck 55 all day, so all its Unplanned work is on his lane.
                unplanned={{ [REAL_DAY.driver.id]: day.truckLog.unplanned.length }}
                onUnplanned={() => day.truckLog.unplanned[0] && answer(day.truckLog.unplanned[0].id)}
              />
            </section>
            {/* An Assignment made from Unplanned work sends Randy no notice, so it is not on his phone. */}
            <DriverView driverName={REAL_DAY.driver.name} date={REAL_DAY.date} assignments={day.assignments.filter((a) => !a.fromTheTruck)} />
          </div>
          <div className="min-w-0">
            <TripLog
              trips={day.tripDay.trips}
              places={REAL_DAY.places}
              assignmentLabels={day.labels}
            />
          </div>
        </div>
        <TruckLog truck={REAL_DAY.truck} date={REAL_DAY.date} truckDay={day.tripDay.truckDay}>
          <TruckLogAssignments columns={day.truckLog.columns} unplanned={day.truckLog.unplanned} shopTrips={day.truckLog.shopTrips} onAnswer={answer} />
        </TruckLog>
        {work && shown && (
          <UnplannedAnswerFlow
            work={{
              id: work.id,
              line: unplannedLine(shown),
              places: work.places.flatMap((p) => {
                const place = REAL_DAY.places.find((x) => x.id === p.placeId);
                return place ? [{ id: place.id, name: place.name }] : [];
              }),
            }}
            materials={REAL_DAY.materials}
            onSave={(next) => {
              setAnswers((all) => [...all.filter((a) => a.unplannedId !== next.unplannedId), next]);
              setAnswering(null);
            }}
            onClose={() => setAnswering(null)}
          />
        )}
      </main>
    </div>
  );
}
