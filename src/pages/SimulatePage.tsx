import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pause, Play, Plus, RotateCcw, X } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { buildTripDay, easternTime, type AssignmentTrips, type FleetVisit, type Trip, type TripAssignment, type TripPlace } from '../../shared/trips';
import { FIXTURE_DATE, FIXTURE_METER, FIXTURE_PLACES, FIXTURE_SCENARIOS, FIXTURE_VISITS } from '../../shared/trips.fixture';

/**
 * The simulation: one Truck, one day, fake data, end to end. Change what HCSS
 * Fleet sent or what Dave planned, move the clock, and see what the Worker
 * would know, which Trips it would write, how each is matched, and what the
 * board and the Driver's card would show. It runs the real Trip builder
 * (shared/trips.ts) in the page; nothing is saved and the Worker is not asked.
 */

/** The fake day is in November, so US Eastern is UTC-5 all day. */
const OFFSET = '-05:00';
const DAY_END = 23 * 60 + 59;
/** Play moves the clock in the steps the Worker pulls Fleet (every 10 minutes). */
const PULL_MINUTES = 10;

const toIso = (time: string) => `${FIXTURE_DATE}T${time.length === 5 ? `${time}:00` : time}${OFFSET}`;
const seconds = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const toTime = (iso: string) => seconds.format(new Date(iso));
const clockTime = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** The page's editable copy of a raw Fleet row, as typed. */
interface VisitRow {
  key: number;
  code: string;
  enter: string;
  exit: string;
  entryOdometer: string;
  exitOdometer: string;
}

/** The page's editable copy of an Assignment, with at most one earlier version (a reroute). */
interface AssignmentRow {
  key: number;
  id: string;
  label: string;
  from: string;
  to: string;
  cancelledAt: string;
  changedAt: string;
  beforeFrom: string;
  beforeTo: string;
}

let nextKey = 1;

const visitRows = (visits: FleetVisit[]): VisitRow[] =>
  visits.map((v) => ({
    key: nextKey++,
    code: v.geofenceCode,
    enter: toTime(v.enteredAt),
    exit: v.exitedAt ? toTime(v.exitedAt) : '',
    entryOdometer: String(v.entryOdometer),
    exitOdometer: v.exitOdometer === null ? '' : String(v.exitOdometer),
  }));

const assignmentRows = (assignments: TripAssignment[]): AssignmentRow[] =>
  assignments.map((a) => {
    const change = a.changes[0];
    return {
      key: nextKey++,
      id: a.id,
      label: a.label,
      from: a.fromPlaceId ?? '',
      to: a.toPlaceId ?? '',
      cancelledAt: a.cancelledAt ? toTime(a.cancelledAt).slice(0, 5) : '',
      changedAt: change ? toTime(change.changedAt).slice(0, 5) : '',
      beforeFrom: change?.before.fromPlaceId ?? '',
      beforeTo: change?.before.toPlaceId ?? '',
    };
  });

const toVisits = (rows: VisitRow[]): FleetVisit[] =>
  rows
    .filter((r) => r.code && r.enter)
    .map((r) => ({
      geofenceCode: r.code,
      enteredAt: toIso(r.enter),
      exitedAt: r.exit ? toIso(r.exit) : null,
      entryOdometer: Number(r.entryOdometer) || 0,
      exitOdometer: r.exit && r.exitOdometer !== '' ? Number(r.exitOdometer) : null,
    }));

const toAssignments = (rows: AssignmentRow[]): TripAssignment[] =>
  rows.map((r) => ({
    id: r.id,
    label: r.label,
    fromPlaceId: r.from || null,
    toPlaceId: r.to || null,
    cancelledAt: r.cancelledAt ? toIso(r.cancelledAt) : null,
    changes: r.changedAt ? [{ changedAt: toIso(r.changedAt), before: { fromPlaceId: r.beforeFrom || null, toPlaceId: r.beforeTo || null } }] : [],
  }));

export function SimulatePage() {
  const [scenarioId, setScenarioId] = useState(FIXTURE_SCENARIOS[0].id);
  const [places, setPlaces] = useState<TripPlace[]>(FIXTURE_PLACES);
  const [visits, setVisits] = useState<VisitRow[]>(() => visitRows(FIXTURE_VISITS));
  const [assignments, setAssignments] = useState<AssignmentRow[]>(() => assignmentRows(FIXTURE_SCENARIOS[0].assignments));
  const [clock, setClock] = useState(DAY_END);
  const [playing, setPlaying] = useState(false);

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

  const scenario = FIXTURE_SCENARIOS.find((s) => s.id === scenarioId)!;
  const dayOver = clock === DAY_END;
  const day = useMemo(
    () =>
      buildTripDay({
        places,
        visits: toVisits(visits),
        assignments: toAssignments(assignments),
        now: toIso(`${clockTime(clock)}:59`),
        // The 4 AM meter reading after the day exists only once the day is over.
        meter: dayOver ? FIXTURE_METER : null,
      }),
    [places, visits, assignments, clock, dayOver],
  );

  const placeName = (id: string | null, code?: string) => places.find((p) => p.id === id)?.name ?? (code ? `${code} (no Place)` : '–');
  const labelOf = (id: string | null) => assignments.find((a) => a.id === id)?.label ?? '–';

  const chooseScenario = (id: string) => {
    const next = FIXTURE_SCENARIOS.find((s) => s.id === id)!;
    setScenarioId(id);
    setAssignments(assignmentRows(next.assignments));
  };
  const reset = () => {
    setPlaces(FIXTURE_PLACES);
    setVisits(visitRows(FIXTURE_VISITS));
    setAssignments(assignmentRows(scenario.assignments));
    setClock(DAY_END);
    setPlaying(false);
  };
  const updateVisit = (key: number, change: Partial<VisitRow>) => setVisits((rows) => rows.map((r) => (r.key === key ? { ...r, ...change } : r)));
  const updateAssignment = (key: number, change: Partial<AssignmentRow>) =>
    setAssignments((rows) => rows.map((r) => (r.key === key ? { ...r, ...change } : r)));

  const written = day.trips.filter((t) => t.written);
  const forDave = written.filter((t) => t.match.kind === null);
  const codes = [...new Set([...places.map((p) => p.geofenceCode).filter((c): c is string => !!c), ...visits.map((v) => v.code)])];

  return (
    <div className="min-h-screen bg-surface">
      <PageHeader title="Simulation" subtitle={`One Truck, one day · fake data · Mon ${FIXTURE_DATE}`}>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Dave’s Assignments</span>
          <NativeSelect aria-label="Scenario" value={scenarioId} onChange={chooseScenario}>
            {FIXTURE_SCENARIOS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </NativeSelect>
        </label>
        <Button variant="outline" onClick={reset}>
          <RotateCcw className="mr-2 h-4 w-4" /> Reset
        </Button>
      </PageHeader>

      <div className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="container space-y-3 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" variant="outline" aria-label={playing ? 'Pause' : 'Play the day'} onClick={() => {
              if (!playing && clock === DAY_END) setClock(4 * 60);
              setPlaying((p) => !p);
            }}>
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
              className="w-64 accent-primary"
            />
            <p className="text-sm">
              What the Worker knows at <strong className="font-display text-lg">{dayOver ? 'end of day' : clockTime(clock)}</strong>
            </p>
            <p className="text-sm text-muted-foreground">{scenario.about}</p>
          </div>
          <ol className="grid gap-2 text-xs sm:grid-cols-5" aria-label="Pipeline">
            <Step n={1} title="Fleet rows" value={`${day.known.length} of ${visits.length}`} from="HCSS Fleet entry/exit, pulled every 10 min → fleet_visits" />
            <Step n={2} title="Visits" value={`${day.visits.length}`} from={`Cleaning: ${day.dropped.length} drive-through, ${day.merged.length} short exit`} />
            <Step n={3} title="Trips" value={`${written.length}${day.trips.length > written.length ? ` (+${day.trips.length - written.length} waiting)` : ''}`} from="Paired visits → trips" />
            <Step
              n={4}
              title="Matched"
              value={`${written.filter((t) => t.match.kind === 'load').length} loads · ${forDave.length} for Dave`}
              from="Assignments + assignment_changes → trips.kind"
            />
            <Step n={5} title="Screens" value={`${day.assignments.filter((a) => a.status === 'now').length ? 'Now' : dayOver ? 'Day done' : '–'}`} from="GET assignments, GET drivers/:id/days/:date" />
          </ol>
        </div>
      </div>

      <main className="container grid gap-6 py-6 xl:grid-cols-2">
        <section aria-labelledby="inputs" className="space-y-6">
          <h2 id="inputs" className="font-display text-xl font-semibold uppercase tracking-wide">
            Inputs (fake data, change anything)
          </h2>

          <Card>
            <CardHeader>
              <CardTitle>Dave’s Assignments</CardTitle>
              <CardDescription>From the board (assignments). A reroute is an earlier version kept in assignment_changes.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {assignments.map((a) => (
                <div key={a.key} className="space-y-2 rounded-md border p-3" aria-label={`Assignment ${a.label}`}>
                  <div className="flex flex-wrap items-end gap-2">
                    <span className="font-semibold">{a.label}</span>
                    <PlaceSelect label={`${a.label} From`} places={places} value={a.from} onChange={(from) => updateAssignment(a.key, { from })} />
                    <span className="pb-2">→</span>
                    <PlaceSelect label={`${a.label} To`} places={places} value={a.to} onChange={(to) => updateAssignment(a.key, { to })} />
                    <Button variant="ghost" size="icon" aria-label={`Remove ${a.label}`} onClick={() => setAssignments((rows) => rows.filter((r) => r.key !== a.key))}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap items-end gap-2 text-sm">
                    <TimeField label={`${a.label} cancelled at`} value={a.cancelledAt} onChange={(cancelledAt) => updateAssignment(a.key, { cancelledAt })} />
                    <TimeField label={`${a.label} changed at`} value={a.changedAt} onChange={(changedAt) => updateAssignment(a.key, { changedAt })} />
                    {a.changedAt && (
                      <>
                        <PlaceSelect label={`${a.label} From before`} places={places} value={a.beforeFrom} onChange={(beforeFrom) => updateAssignment(a.key, { beforeFrom })} />
                        <PlaceSelect label={`${a.label} To before`} places={places} value={a.beforeTo} onChange={(beforeTo) => updateAssignment(a.key, { beforeTo })} />
                      </>
                    )}
                  </div>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const n = assignments.length + 1;
                  setAssignments((rows) => [...rows, { key: nextKey++, id: `new-${nextKey}`, label: `A${n}`, from: '', to: '', cancelledAt: '', changedAt: '', beforeFrom: '', beforeTo: '' }]);
                }}
              >
                <Plus className="mr-1 h-4 w-4" /> Assignment
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Raw HCSS Fleet visits</CardTitle>
              <CardDescription>
                What Fleet sends: one row per stay in a geofence, times in US Eastern. An empty exit means the Truck is still there. Greyed rows are after the clock.
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="pr-2">Geofence</th>
                    <th className="pr-2">Enter</th>
                    <th className="pr-2">Exit</th>
                    <th className="pr-2">Odometer in</th>
                    <th className="pr-2">Odometer out</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {visits.map((v, i) => {
                    const future = v.enter > `${clockTime(clock)}:59`;
                    const dropped = day.dropped.some((d) => d.raw === i);
                    return (
                      <tr key={v.key} className={cn(future && 'opacity-40', dropped && 'line-through decoration-muted-foreground')}>
                        <td className="py-1 pr-2">
                          <NativeSelect aria-label={`Row ${i + 1} geofence`} value={v.code} onChange={(code) => updateVisit(v.key, { code })}>
                            {codes.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </NativeSelect>
                        </td>
                        <td className="pr-2">
                          <Input aria-label={`Row ${i + 1} enter`} type="time" step={1} className="h-8 w-32" value={v.enter} onChange={(e) => updateVisit(v.key, { enter: e.target.value })} />
                        </td>
                        <td className="pr-2">
                          <Input aria-label={`Row ${i + 1} exit`} type="time" step={1} className="h-8 w-32" value={v.exit} onChange={(e) => updateVisit(v.key, { exit: e.target.value })} />
                        </td>
                        <td className="pr-2">
                          <Input aria-label={`Row ${i + 1} odometer in`} inputMode="decimal" className="h-8 w-28" value={v.entryOdometer} onChange={(e) => updateVisit(v.key, { entryOdometer: e.target.value })} />
                        </td>
                        <td className="pr-2">
                          <Input aria-label={`Row ${i + 1} odometer out`} inputMode="decimal" className="h-8 w-28" value={v.exitOdometer} onChange={(e) => updateVisit(v.key, { exitOdometer: e.target.value })} />
                        </td>
                        <td>
                          <Button variant="ghost" size="icon" aria-label={`Remove row ${i + 1}`} onClick={() => setVisits((rows) => rows.filter((r) => r.key !== v.key))}>
                            <X className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => {
                  const last = visits.at(-1);
                  setVisits((rows) => [...rows, { key: nextKey++, code: codes[0] ?? 'SHOP', enter: last?.exit || '12:00:00', exit: '', entryOdometer: last?.exitOdometer ?? '0', exitOdometer: '' }]);
                }}
              >
                <Plus className="mr-1 h-4 w-4" /> Fleet row
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Places</CardTitle>
              <CardDescription>From Settings (places). A Place matches Fleet by its geofence code: “On the truck map”.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {places.map((p) => (
                <label key={p.id} className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={p.geofenceCode !== null}
                    onChange={(e) => {
                      const code = FIXTURE_PLACES.find((f) => f.id === p.id)?.geofenceCode ?? null;
                      setPlaces((list) => list.map((x) => (x.id === p.id ? { ...x, geofenceCode: e.target.checked ? code : null } : x)));
                    }}
                    aria-label={`${p.name} on the truck map`}
                  />
                  <span className="w-40 font-medium">{p.name}</span>
                  <span className="w-20 text-muted-foreground">{p.kind?.replace('_', ' ')}</span>
                  <span className="text-muted-foreground">{p.geofenceCode ?? 'Not on the truck map'}</span>
                </label>
              ))}
              <p className="pt-2 text-muted-foreground">
                Meter readings (4 AM, meter_readings): {FIXTURE_METER.startOdometer} → {FIXTURE_METER.endOdometer}, known once the day is over.
              </p>
            </CardContent>
          </Card>
        </section>

        <section aria-labelledby="outputs" className="space-y-6">
          <h2 id="outputs" className="font-display text-xl font-semibold uppercase tracking-wide">
            What the app would show
          </h2>

          <Card>
            <CardHeader>
              <CardTitle>Board (Dave)</CardTitle>
              <CardDescription>New fields on GET assignments, worked out from written Trips, never stored or typed.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {assignments.map((a) => (
                <BoardBlock key={a.key} label={a.label} route={`${placeName(a.from || null)} → ${placeName(a.to || null)}`} trips={day.assignments.find((x) => x.assignmentId === a.id)} />
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Driver view (his phone)</CardTitle>
              <CardDescription>The same fields on each DriverAssignment in GET drivers/:id/days/:date.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {assignments.map((a) => {
                const t = day.assignments.find((x) => x.assignmentId === a.id);
                return (
                  <article key={a.key} aria-label={`Driver card ${a.label}`} className="rounded-lg border bg-card p-4">
                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 text-lg">
                      <dt className="text-muted-foreground">Pick up</dt>
                      <dd className="font-medium">{placeName(a.from || null)}</dd>
                      <dt className="text-muted-foreground">Drop off</dt>
                      <dd className="font-medium">{placeName(a.to || null)}</dd>
                    </dl>
                    <p className="mt-2 text-lg font-semibold">
                      {t && t.loads > 0 ? `${t.loads} ${t.loads === 1 ? 'load' : 'loads'} · last ${easternTime(t.lastLoadAt!)}` : 'No loads yet'}
                    </p>
                  </article>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Trip log</CardTitle>
              <CardDescription>
                The trips table. Rule is the matching rule that decided it (docs/design/telematics-backend.md §3). “Waiting” is not written yet.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {forDave.length > 0 && (
                <p className="rounded-md bg-warning/20 p-2 text-sm" role="status">
                  For Dave next morning: {forDave.map((t) => `${easternTime(t.leftAt)} ${placeName(t.fromPlaceId, t.fromCode)} → ${placeName(t.toPlaceId, t.toCode)}`).join('; ')}
                </p>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-sm" aria-label="Trips">
                  <thead className="text-left text-muted-foreground">
                    <tr>
                      <th className="pr-2">Left</th>
                      <th className="pr-2">From → To</th>
                      <th className="pr-2">Miles</th>
                      <th className="pr-2">Kind</th>
                      <th className="pr-2">Assignment</th>
                      <th>Why</th>
                    </tr>
                  </thead>
                  <tbody>
                    {day.trips.map((t) => (
                      <TripRow key={t.leftAt} trip={t} placeName={placeName} labelOf={labelOf} />
                    ))}
                  </tbody>
                </table>
              </div>
              {day.trips.length === 0 && <p className="text-sm text-muted-foreground">No Trips yet at this time.</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Checks</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              {day.dropped.map((d) => (
                <p key={d.raw}>Row {d.raw + 1} dropped. {d.reason}.</p>
              ))}
              {day.merged.map((m) => (
                <p key={m.into}>
                  Rows {m.raw.map((r) => r + 1).join(' and ')} joined. {m.reason}.
                </p>
              ))}
              {day.unknownCodes.length > 0 && <p className="text-destructive">Geofence codes with no Place (listed for Dave in Settings): {day.unknownCodes.join(', ')}</p>}
              <p>
                Miles: Trips {day.miles.trips} + inside Places {day.miles.insidePlaces} ={' '}
                {Math.round((day.miles.trips + day.miles.insidePlaces) * 100) / 100}
                {day.miles.day === null
                  ? ' (the day’s meter reading comes at 4 AM)'
                  : ` vs meter ${day.miles.day}: ${day.miles.ok ? 'OK' : 'something was missed'}`}
              </p>
            </CardContent>
          </Card>

          <FieldMap />
        </section>
      </main>
    </div>
  );
}

function Step({ n, title, value, from }: { n: number; title: string; value: string; from: string }) {
  return (
    <li className="rounded-md border bg-card p-2">
      <p className="font-semibold">
        {n}. {title}: <span className="font-display text-base">{value}</span>
      </p>
      <p className="text-muted-foreground">{from}</p>
    </li>
  );
}

const STATUS_WORDS: Record<AssignmentTrips['status'], string> = { none: 'Not started', now: 'Now', done: 'Done' };

function BoardBlock({ label, route, trips }: { label: string; route: string; trips: AssignmentTrips | undefined }) {
  const status = trips?.status ?? 'none';
  return (
    <article aria-label={`Board block ${label}`} className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-card p-3">
      <div>
        <p className="font-semibold">
          {label} · {route}
        </p>
        <p className="text-sm text-muted-foreground">
          {trips && trips.loads > 0 ? `${trips.loads} ${trips.loads === 1 ? 'load' : 'loads'}` : 'No loads yet'}
          {trips?.firstTripAt && ` · since ${easternTime(trips.firstTripAt)}`}
        </p>
      </div>
      <span
        className={cn(
          'rounded px-2 py-1 text-sm font-semibold',
          status === 'now' && 'bg-success text-success-foreground',
          status === 'done' && 'bg-muted text-foreground',
          status === 'none' && 'text-muted-foreground',
        )}
      >
        {STATUS_WORDS[status]}
      </span>
    </article>
  );
}

const KIND_STYLE: Record<string, string> = {
  load: 'bg-success text-success-foreground',
  empty: 'bg-muted text-foreground',
  null: 'bg-warning text-warning-foreground',
};

function TripRow({ trip, placeName, labelOf }: { trip: Trip; placeName: (id: string | null, code?: string) => string; labelOf: (id: string | null) => string }) {
  const kind = trip.written ? String(trip.match.kind) : 'waiting';
  return (
    <tr className={cn('border-t', !trip.written && 'text-muted-foreground')}>
      <td className="py-1 pr-2">{easternTime(trip.leftAt)}</td>
      <td className="pr-2">
        {placeName(trip.fromPlaceId, trip.fromCode)} → {placeName(trip.toPlaceId, trip.toCode)}
      </td>
      <td className="pr-2">{trip.miles}</td>
      <td className="pr-2">
        <span className={cn('rounded px-1.5 py-0.5 text-xs font-semibold', KIND_STYLE[kind])}>{kind === 'null' ? 'for Dave' : kind}</span>
      </td>
      <td className="pr-2">{labelOf(trip.match.assignmentId)}</td>
      <td className="text-muted-foreground">
        {trip.match.rule}. {trip.match.reason}
      </td>
    </tr>
  );
}

/** Every field the Trip screens need: where it comes from and when it changes. */
const FIELDS: { field: string; shown: string; from: string; when: string; missing: string }[] = [
  { field: 'Fleet visit', shown: 'Trip log (raw)', from: 'HCSS Fleet entry/exit → fleet_visits', when: 'Each pull, every 10 min, 4 AM–8 PM', missing: 'Truck not linked to HCSS Fleet: no Trips at all' },
  { field: 'Place of a visit', shown: 'Trip log', from: 'places.geofence_code (Settings: On the truck map)', when: 'When Dave maps the code', missing: 'Listed for Dave as a code with no Place' },
  { field: 'Trip', shown: 'Trip log', from: 'trips, built from cleaned visits', when: 'Once the visit it reaches is 2 min old', missing: '“No Trips yet”' },
  { field: 'kind (load / empty)', shown: 'Trip log, board', from: 'Matching: assignments + assignment_changes', when: 'When the Trip is written; Dave or the Driver can answer', missing: '“For Dave” next morning' },
  { field: 'loads', shown: 'Board block, Driver card', from: 'Count of trips with kind load for the Assignment', when: 'Each written Load', missing: '“No loads yet”' },
  { field: 'Now / Done', shown: 'Board block', from: 'Latest written Trip (proposal P5)', when: 'Each written Trip', missing: '“Not started”' },
  { field: 'since', shown: 'Board block', from: 'left_at of its first Trip', when: 'First Trip', missing: 'Hidden' },
  { field: 'last (load time)', shown: 'Driver card', from: 'arrived_at of its latest Load', when: 'Each Load', missing: 'Hidden' },
  { field: 'Driver of a Trip', shown: 'Trip log, Truck log', from: 'Latest Inspection of that Truck (phase 2)', when: 'At check-in', missing: 'Dave answers “Who was driving?”' },
  { field: 'Day miles', shown: 'Truck log', from: 'meter_readings at 4 AM around the day', when: 'Next morning', missing: 'Check waits for the reading' },
];

function FieldMap() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Where each field comes from</CardTitle>
        <CardDescription>What the screens need, the table it is read from, when it changes, and what shows while it is missing.</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full text-sm" aria-label="Field map">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="pr-2">Field</th>
              <th className="pr-2">Shown on</th>
              <th className="pr-2">Comes from</th>
              <th className="pr-2">Changes</th>
              <th>While missing</th>
            </tr>
          </thead>
          <tbody>
            {FIELDS.map((f) => (
              <tr key={f.field} className="border-t align-top">
                <td className="py-1 pr-2 font-medium">{f.field}</td>
                <td className="pr-2">{f.shown}</td>
                <td className="pr-2">{f.from}</td>
                <td className="pr-2">{f.when}</td>
                <td>{f.missing}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function NativeSelect({ value, onChange, children, ...rest }: { value: string; onChange: (value: string) => void; children: ReactNode; 'aria-label'?: string }) {
  return (
    <select
      {...rest}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </select>
  );
}

function PlaceSelect({ label, places, value, onChange }: { label: string; places: TripPlace[]; value: string; onChange: (value: string) => void }) {
  return (
    <NativeSelect aria-label={label} value={value} onChange={onChange}>
      <option value="">(empty)</option>
      {places.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </NativeSelect>
  );
}

function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-muted-foreground">{label.split(' ').slice(1).join(' ')}</span>
      <Input aria-label={label} type="time" className="h-8 w-32" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
