import { useCallback, useMemo, useState } from 'react';
import { ClipboardList } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Lanes } from '@/components/Lanes';
import { PageHeader } from '@/components/PageHeader';
import { TruckLog } from '@/components/TruckLog';
import { TruckLogAssignments, unplannedLine } from '@/components/TruckLogAssignments';
import { Button } from '@/components/ui/button';
import { DriverView } from '@/components/DriverView';
import { TripLog } from '@/components/TripLog';
import { UnplannedAnswerFlow } from '@/simulate/UnplannedAnswerFlow';
import { madeAssignmentId, type UnplannedAnswer } from '@/simulate/answers';
import { REAL_DAY, placeName } from '@/simulate/realDay';
import { ReplayClock } from '@/components/ReplayClock';
import { simulateAt } from '@/simulate/simulate';
import { DAY_END, easternTime } from '../../shared/days';

/**
 * The simulation: Truck 55 (MCK-55-17), driven by Randy on Mon 16 Nov 2026,
 * on the real HCSS Fleet data. A clock (drag it, or play the day in 10-minute
 * steps) and a scenario picker (Dave's Assignments as planned, the other way
 * round, the reroute at 11:20), then the Scheduler view (Randy's lane on the
 * real board lanes) and the Driver view (his Today on the real Driver cards)
 * and the Truck log (the paper Daily Truck Log: header, one column per
 * Assignment, and the Unplanned work), each with what the
 * Trip builder works out at the clock's time. Dave answers the Unplanned work
 * from the lane or the Truck log, or splits it in two; the
 * answers and splits are held here, in memory, and a new scenario starts
 * with none. Made-up scenarios add Unplanned work to split and a second Driver on
 * Truck 55 ("Who was driving?", asked first when Dave answers). Nothing is saved and the Worker is not asked.
 */
export function SimulatePage() {
  const [scenarioId, setScenarioId] = useState(REAL_DAY.scenarios[0].id);
  const [clock, setClock] = useState(DAY_END);
  const [answers, setAnswers] = useState<UnplannedAnswer[]>([]);
  /** Where Dave split Unplanned work in two: each Trip's leftAt. */
  const [splits, setSplits] = useState<string[]>([]);
  /** The Unplanned work being answered (its id); null when none is. */
  const [answering, setAnswering] = useState<string | null>(null);

  const scenario = REAL_DAY.scenarios.find((s) => s.id === scenarioId) ?? REAL_DAY.scenarios[0];
  const day = useMemo(() => simulateAt({ scenario, minutes: clock, answers, splits }), [scenario, clock, answers, splits]);
  const { truckDay } = day.tripDay;
  /** "Who was driving?": more than one Driver fits and Dave has not picked yet. */
  const whoDrove = truckDay.driver === null && truckDay.driverCandidates.length > 1 ? truckDay.driverCandidates : null;
  const openAnswer = useCallback((unplannedId: string) => setAnswering(unplannedId), []);
  /** Truck 55's Unplanned work is on its Driver's lane; while "Who was driving?" is open, on each who fits. */
  const laneUnplanned = (driverId: string) =>
    (truckDay.driver ? truckDay.driver.id === driverId : truckDay.driverCandidates.some((d) => d.id === driverId)) ? day.truckLog.unplanned : [];
  /** The lane's marker opens the Driver's first Unplanned work Dave has not answered yet (else his first). */
  const openFromLane = (driverId: string) => {
    const own = laneUnplanned(driverId);
    const next = own.find((w) => !answers.some((a) => a.unplannedId === w.id)) ?? own[0];
    if (next) openAnswer(next.id);
  };
  /** The Unplanned work being answered: as the Trip builder has it (its Trips and Places), and as the Truck log shows it (its line). */
  const answeringWork = day.tripDay.unplanned.find((w) => w.id === answering);
  const answeringBox = day.truckLog.unplanned.find((w) => w.id === answering);

  return (
    <div className="min-h-screen bg-surface">
      <PageHeader title="Simulation" subtitle={`Truck ${REAL_DAY.truck.number} (${REAL_DAY.truck.hcssCode}) · ${day.drivers.map((d) => d.name).join(', ')} · Mon 16 Nov 2026`}>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Dave’s Assignments</span>
          <select
            aria-label="Scenario"
            value={scenario.id}
            onChange={(e) => {
              setScenarioId(e.target.value);
              // The answers were to this scenario's Unplanned work: a new scenario starts with none.
              setAnswers([]);
              setSplits([]);
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
        <ReplayClock clock={clock} onClock={setClock} className="container py-3" />
      </div>

      <main className="container space-y-6 py-6">
        <div className="grid gap-6 xl:grid-cols-2">
          <div className="min-w-0 space-y-6">
            <section aria-label="Scheduler view" className="space-y-3">
              <h2 className="font-display text-xl font-semibold uppercase tracking-wide">Scheduler view</h2>
              <Lanes
                assignments={day.assignments}
                drivers={day.drivers}
                trucks={[REAL_DAY.truck]}
                unplanned={Object.fromEntries(day.drivers.map((d) => [d.id, laneUnplanned(d.id).length]))}
                onUnplanned={openFromLane}
              />
            </section>
            {/* An Assignment made from Unplanned work sends Randy no notice, so it is not on his phone. */}
            <DriverView
              date={REAL_DAY.date}
              phones={[
                {
                  driverId: REAL_DAY.driver.id,
                  driverName: REAL_DAY.driver.name,
                  assignments: day.assignments.filter((a) => !a.fromTheTruck && a.driverId === REAL_DAY.driver.id),
                },
              ]}
            />
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
          <TruckLogAssignments log={day.truckLog} onAnswer={openAnswer} />
        </TruckLog>
        {answeringWork && answeringBox && (
          <UnplannedAnswerFlow
            work={{
              id: answeringWork.id,
              line: unplannedLine(answeringBox),
              places: answeringWork.places.flatMap((p) => {
                const name = placeName(p.placeId);
                return p.placeId && name ? [{ id: p.placeId, name }] : [];
              }),
              splits: answeringWork.trips.slice(1).map((t) => ({
                at: t.leftAt,
                label: `Split at ${easternTime(t.leftAt)} · ${placeName(t.fromPlaceId) ?? t.fromCode} → ${placeName(t.toPlaceId) ?? t.toCode}`,
              })),
            }}
            materials={REAL_DAY.materials}
            drivers={whoDrove ?? undefined}
            driverId={truckDay.driver?.id ?? null}
            onSplit={(at) => {
              setSplits((all) => [...all, at]);
              // It is now two: an answer to it was to the whole.
              setAnswers((all) => all.filter((a) => a.unplannedId !== answeringWork.id));
              setAnswering(null);
            }}
            // A link names one of that day's Assignments, never the one made from this same Unplanned work; the flow offers only the picked Driver's.
            assignments={day.assignments
              .filter((a) => a.date === REAL_DAY.date && a.id !== madeAssignmentId(answeringWork.id))
              .map((a) => ({ id: a.id, label: `${day.labels[a.id]} · ${a.fromPlaceName ?? '–'} → ${a.toPlaceName ?? '–'}`, driverId: a.driverId ?? undefined }))}
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
