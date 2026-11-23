import { useRef, useState, type DragEvent } from 'react';
import { ClipboardList, Loader2, Upload } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Refused, importFleetExport } from '@/lib/api';
import { cn } from '@/lib/utils';
import { readFleetJson, type FleetExportRow } from '../../shared/fleetExport';
import type { FleetExportFormat, FleetImport, FleetImportDay } from '../../shared/types';

/** A dropped file's text. FileReader, as every browser (and jsdom) has it. */
function textOf(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'));
    reader.readAsText(file);
  });
}

/**
 * A dropped file as the Import route takes it: its format and rows. The page
 * parses; the Worker never does. Each format's reader is in shared/fleetExport.ts.
 */
async function readExport(file: File): Promise<{ format: FleetExportFormat; rows: FleetExportRow[] }> {
  if (!/\.json$/i.test(file.name) && file.type !== 'application/json') {
    throw new Error('Drop a JSON Fleet export (a .json file).');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await textOf(file));
  } catch {
    throw new Error('This file is not JSON. Export the entry/exit report from HCSS Fleet and drop that.');
  }
  return { format: 'json', rows: readFleetJson(parsed) };
}

/** "Mon 16 Nov". */
const dayLabel = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });

/** "Mon 16 Nov: 3 new · 1 closed": a day the Import touched, with its counts (closed and already stored only when there are some). */
const dayCounts = (day: FleetImportDay) =>
  `${dayLabel(day.date)}: ${[`${day.added} new`, day.closed > 0 && `${day.closed} closed`, day.unchanged > 0 && `${day.unchanged} already stored`].filter(Boolean).join(' · ')}`;

/** One dropped file: importing, imported with what it changed, or not imported and why. */
type Drop = { key: number; fileName: string } & ({ state: 'importing' } | { state: 'imported'; result: FleetImport } | { state: 'failed'; reason: string });

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
    let read: Awaited<ReturnType<typeof readExport>>;
    try {
      read = await readExport(file);
    } catch (error) {
      return failed(error instanceof Error ? error.message : 'Could not read the file.');
    }
    try {
      update({ key, fileName: file.name, state: 'imported', result: await importFleetExport({ fileName: file.name, ...read }) });
    } catch (error) {
      failed(error instanceof Refused ? error.message : 'Could not import it. Check the connection and drop it again.');
    }
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
          <p className="text-sm text-muted-foreground">The entry/exit report from HCSS Fleet, as JSON. Or tap to pick a file.</p>
          <input
            ref={picker}
            type="file"
            accept=".json,application/json"
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
                  {drop.state === 'imported' && (
                    <>
                      <p className="font-display text-2xl font-semibold">
                        {drop.result.added} new · {drop.result.closed} closed · {drop.result.unchanged} already stored
                      </p>
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
                              <li key={c.code} className="rounded-md border px-2 py-0.5 text-sm">
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
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
