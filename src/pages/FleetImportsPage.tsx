import { useRef, useState, type CSSProperties, type DragEvent } from 'react';
import { ClipboardList, Loader2, Upload } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { chipClass } from '@/components/TypedName';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Refused, fetchList, importFleetExport } from '@/lib/api';
import { cn } from '@/lib/utils';
import { EXPORT_ADVICE, countFleetXlsxVisits, readFleetJson, readFleetXlsx, type FleetExportRow, type FleetSheet } from '../../shared/fleetExport';
import type { FleetExportFormat, FleetImport, FleetImportDay, ImportCounts, Truck } from '../../shared/types';

/** A dropped file's text or bytes. FileReader, as every browser (and jsdom) has it. */
function readFile(file: File, as: 'text'): Promise<string>;
function readFile(file: File, as: 'bytes'): Promise<ArrayBuffer>;
function readFile(file: File, as: 'text' | 'bytes'): Promise<string | ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string | ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'));
    if (as === 'text') reader.readAsText(file);
    else reader.readAsArrayBuffer(file);
  });
}

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const isXlsx = (file: File) => /\.xlsx$/i.test(file.name) || file.type === XLSX_TYPE;

/**
 * An xlsx Fleet export's sheet, read for the Truck Dave picks (the xlsx names
 * no Truck). The xlsx library loads only here, when an xlsx is dropped, so no
 * other page (and not even this one, until then) downloads it.
 */
async function readXlsxSheet(file: File): Promise<FleetSheet> {
  const [{ readSheet }, bytes] = await Promise.all([import('read-excel-file/universal'), readFile(file, 'bytes')]);
  try {
    return await readSheet(bytes);
  } catch {
    throw new Error(`This file is not an xlsx spreadsheet. ${EXPORT_ADVICE}`);
  }
}

/**
 * A dropped file as the Import route takes it: its format and rows. The page
 * parses; the Worker never does. Each format's reader is in shared/fleetExport.ts.
 * An xlsx gives no Truck: its rows come once Dave picks one (forTruck).
 */
async function readExport(
  file: File,
): Promise<{ format: 'json'; rows: FleetExportRow[] } | { format: 'xlsx'; visits: number; forTruck: (hcssCode: string) => FleetExportRow[] }> {
  if (isXlsx(file)) {
    const sheet = await readXlsxSheet(file);
    // Checked now, so a sheet that is not the entry/exit report is refused before Dave picks a Truck.
    const visits = countFleetXlsxVisits(sheet);
    return { format: 'xlsx', visits, forTruck: (hcssCode) => readFleetXlsx(sheet, hcssCode) };
  }
  if (!/\.json$/i.test(file.name) && file.type !== 'application/json') {
    throw new Error('Drop a Fleet export: a .json or .xlsx file.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, 'text'));
  } catch {
    throw new Error(`This file is not JSON. ${EXPORT_ADVICE}`);
  }
  return { format: 'json', rows: readFleetJson(parsed) };
}

/** "Mon 16 Nov". */
const dayLabel = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });

/**
 * "6 new · 1 closed · 7 already stored". With `brief`, closed and already
 * stored only when there are some ("3 new · 1 closed").
 */
const countsLabel = (counts: ImportCounts, brief = false) =>
  [
    `${counts.added} new`,
    (!brief || counts.closed > 0) && `${counts.closed} closed`,
    (!brief || counts.unchanged > 0) && `${counts.unchanged} already stored`,
  ]
    .filter(Boolean)
    .join(' · ');

/** "Mon 16 Nov: 3 new · 1 closed": a day the Import touched, with its counts. */
const dayCounts = (day: FleetImportDay) => `${dayLabel(day.date)}: ${countsLabel(day, true)}`;

/** A Truck an xlsx can be imported for: one with an HCSS code. */
type CodedTruck = Truck & { hcssCode: string };

/** One dropped file: importing, waiting for its Truck, imported with what it changed, or not imported and why. */
type Drop = { key: number; fileName: string } & (
  | { state: 'importing' }
  | { state: 'pickTruck'; visits: number; trucks: CodedTruck[]; picked: string | null; pick: (truck: CodedTruck) => void }
  | { state: 'imported'; result: FleetImport }
  | { state: 'failed'; reason: string }
);

/**
 * Fleet imports: where Dave drops each HCSS Fleet export as it
 * comes. Each drop is an Import; the page says how many visits were new, closed and already stored.
 */
export function FleetImportsPage() {
  const [drops, setDrops] = useState<Drop[]>([]);
  const [over, setOver] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const counter = useRef(0);

  const importFile = async (file: File) => {
    const key = ++counter.current;
    const update = (drop: Drop) => setDrops((all) => all.map((d) => (d.key === key ? drop : d)));
    setDrops((all) => [{ key, fileName: file.name, state: 'importing' }, ...all]);
    const failed = (reason: string) => update({ key, fileName: file.name, state: 'failed', reason });
    const send = async (format: FleetExportFormat, rows: FleetExportRow[]) => {
      try {
        update({ key, fileName: file.name, state: 'imported', result: await importFleetExport({ fileName: file.name, format, rows }) });
      } catch (error) {
        failed(error instanceof Refused ? error.message : 'Could not import it. Check the connection and drop it again.');
      }
    };
    let read: Awaited<ReturnType<typeof readExport>>;
    try {
      read = await readExport(file);
    } catch (error) {
      return failed(error instanceof Error ? error.message : 'Could not read the file.');
    }
    if (read.format === 'json') return send('json', read.rows);

    // The xlsx names no Truck: Dave picks one of the Trucks with an HCSS code.
    const { visits, forTruck } = read;
    let trucks: CodedTruck[];
    try {
      trucks = (await fetchList('trucks')).flatMap((truck) => (truck.hcssCode ? [{ ...truck, hcssCode: truck.hcssCode }] : []));
    } catch {
      return failed('Could not load the Trucks. Check the connection and drop it again.');
    }
    if (trucks.length === 0) return failed('An xlsx export does not say which Truck it is for, and no Truck has an HCSS code. Set one in Settings.');
    const asking: Extract<Drop, { state: 'pickTruck' }> = {
      key,
      fileName: file.name,
      state: 'pickTruck',
      visits,
      trucks,
      picked: null,
      pick: (truck) => {
        // The picked chip stays pressed until the Worker answers.
        update({ ...asking, picked: truck.id });
        void send('xlsx', forTruck(truck.hcssCode));
      },
    };
    update(asking);
  };
  const importAll = (files: FileList | null) => {
    for (const file of Array.from(files ?? [])) void importFile(file);
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    importAll(event.dataTransfer.files);
  };

  return (
    <div className="min-h-screen bg-surface">
      <PageHeader title="Fleet imports" subtitle="HCSS Fleet exports, and what each one stored">
        <Button asChild variant="outline" size="lg" className="px-5">
          <Link to="/">
            <ClipboardList className="h-4 w-4" /> Board
          </Link>
        </Button>
      </PageHeader>

      <main className="container space-y-6 py-6">
        <div
          role="button"
          tabIndex={0}
          aria-label="Drop a Fleet export here, or pick a file"
          onClick={() => picker.current?.click()}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              picker.current?.click();
            }
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
          className={cn(
            'flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed bg-background p-6 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            over ? 'border-primary bg-primary/5' : 'border-border',
          )}
        >
          <Upload className="h-6 w-6 text-muted-foreground" aria-hidden />
          <p className="font-medium">Drop a Fleet export here</p>
          <p className="text-sm text-muted-foreground">The entry/exit report from HCSS Fleet, as JSON or xlsx. Or tap to pick a file.</p>
          <input
            ref={picker}
            type="file"
            accept=".json,application/json,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            multiple
            aria-label="Pick a file"
            className="sr-only"
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => {
              importAll(event.target.files);
              event.target.value = '';
            }}
          />
        </div>

        {drops.length > 0 && (
          <section aria-label="Imports" className="space-y-2">
            <h2 className="font-display text-xl font-semibold uppercase tracking-wide">Imports</h2>
            <ul className="space-y-2">
              {drops.map((drop, i) => (
                <li key={drop.key} className="animate-rise" style={{ '--i': i } as CSSProperties}>
                  <Card className="p-4">
                    {drop.state === 'importing' && (
                      <p className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" /> Importing {drop.fileName}…
                      </p>
                    )}
                    {drop.state === 'pickTruck' && (
                      <>
                        <p className="font-medium">Which Truck is {drop.fileName} for?</p>
                        <p className="text-sm text-muted-foreground">
                          {drop.visits} {drop.visits === 1 ? 'visit' : 'visits'}. An xlsx export does not name its Truck.
                        </p>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          {drop.trucks.map((truck) => {
                            const pressed = drop.picked === truck.id;
                            return (
                              <Button
                                key={truck.id}
                                type="button"
                                variant={pressed ? 'default' : 'outline'}
                                aria-pressed={pressed}
                                disabled={drop.picked !== null && !pressed}
                                className={chipClass(pressed)}
                                onClick={() => drop.picked === null && drop.pick(truck)}
                              >
                                Truck {truck.number} ({truck.hcssCode})
                              </Button>
                            );
                          })}
                          {drop.picked !== null && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Importing" />}
                        </div>
                      </>
                    )}
                    {drop.state === 'imported' && (
                      <>
                        <p className="font-display text-2xl font-semibold">{countsLabel(drop.result)}</p>
                        <p className="text-sm text-muted-foreground">
                          {drop.fileName} · Truck {drop.result.truckNumber}
                        </p>
                        <p className="text-sm">{drop.result.days.map(dayCounts).join('; ')}</p>
                        {drop.result.codesWithNoPlace.length > 0 && (
                          <div className="mt-3">
                            <h3 id={`no-place-${drop.key}`} className="text-sm font-medium">
                              Codes with no Place
                            </h3>
                            <p className="text-xs text-muted-foreground">Their visits are stored. Give a Place its geofence code in Settings.</p>
                            <ul aria-labelledby={`no-place-${drop.key}`} className="mt-1 flex flex-wrap gap-2">
                              {drop.result.codesWithNoPlace.map((c) => (
                                <li key={c.code} className="rounded-full border bg-surface px-3 py-1 text-sm">
                                  {c.code}
                                  {c.driveThrough && <span className="text-muted-foreground"> · drive-through</span>}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </>
                    )}
                    {drop.state === 'failed' && (
                      <>
                        <p className="text-sm font-medium">{drop.fileName} was not imported</p>
                        <p className="text-sm text-destructive">{drop.reason}</p>
                      </>
                    )}
                  </Card>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
