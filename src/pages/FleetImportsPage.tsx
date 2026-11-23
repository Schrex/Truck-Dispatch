import { useRef, useState, type DragEvent } from 'react';
import { ClipboardList, Loader2, Upload } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Refused, fetchList, importFleetExport } from '@/lib/api';
import { cn } from '@/lib/utils';
import { readFleetJson, readFleetXlsx, type FleetExportRow, type FleetSheet } from '../../shared/fleetExport';
import type { FleetExportFormat, FleetImport, Truck } from '../../shared/types';

/** A dropped file's text. FileReader, as every browser (and jsdom) has it. */
function textOf(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'));
    reader.readAsText(file);
  });
}

/** A dropped file's bytes. FileReader, as every browser (and jsdom) has it. */
function bytesOf(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'));
    reader.readAsArrayBuffer(file);
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
  const [{ readSheet }, bytes] = await Promise.all([import('read-excel-file/universal'), bytesOf(file)]);
  try {
    return await readSheet(bytes);
  } catch {
    throw new Error('This file is not an xlsx spreadsheet. Export the entry/exit report from HCSS Fleet and drop that.');
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
    // Read once now, so a sheet that is not the entry/exit report is refused before Dave picks a Truck.
    const visits = readFleetXlsx(sheet, '').length;
    return { format: 'xlsx', visits, forTruck: (hcssCode) => readFleetXlsx(sheet, hcssCode) };
  }
  if (!/\.json$/i.test(file.name) && file.type !== 'application/json') {
    throw new Error('Drop a Fleet export: a .json or .xlsx file.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await textOf(file));
  } catch {
    throw new Error('This file is not JSON. Export the entry/exit report from HCSS Fleet and drop that.');
  }
  return { format: 'json', rows: readFleetJson(parsed) };
}

const dayLabel = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });

/** One dropped file: importing, imported with what it changed, or not imported and why. */
type Drop = { key: number; fileName: string } & (
  | { state: 'importing' }
  | { state: 'pickTruck'; visits: number; trucks: Truck[]; pick: (truck: Truck) => void }
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
      update({ key, fileName: file.name, state: 'importing' });
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
    let trucks: Truck[];
    try {
      trucks = (await fetchList('trucks')).filter((truck) => truck.hcssCode);
    } catch {
      return failed('Could not load the Trucks. Check the connection and drop it again.');
    }
    if (trucks.length === 0) return failed('An xlsx export does not say which Truck it is for, and no Truck has an HCSS code. Set one in Settings.');
    update({ key, fileName: file.name, state: 'pickTruck', visits, trucks, pick: (truck) => void send('xlsx', forTruck(truck.hcssCode ?? '')) });
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
      <PageHeader title="Fleet imports" subtitle="Drop each HCSS Fleet export as it comes">
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
              {drops.map((drop) => (
                <li key={drop.key} className="rounded-lg border bg-background p-4">
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
                      <div className="mt-3 flex flex-wrap gap-2">
                        {drop.trucks.map((truck) => (
                          <Button key={truck.id} variant="outline" size="lg" onClick={() => drop.pick(truck)}>
                            Truck {truck.number} ({truck.hcssCode})
                          </Button>
                        ))}
                      </div>
                    </>
                  )}
                  {drop.state === 'imported' && (
                    <>
                      <p className="font-display text-2xl font-semibold">
                        {drop.result.added} new · {drop.result.closed} closed · {drop.result.unchanged} already stored
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {drop.fileName} · Truck {drop.result.truckNumber} · {drop.result.days.map(dayLabel).join(', ')}
                      </p>
                    </>
                  )}
                  {drop.state === 'failed' && (
                    <>
                      <p className="text-sm font-medium">{drop.fileName} was not imported</p>
                      <p className="text-sm text-destructive">{drop.reason}</p>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
