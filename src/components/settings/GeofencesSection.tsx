import { useEffect, useState } from 'react';
import type { Geofence } from '../../../shared/types';
import { EmptyBox, Loading } from '@/components/States';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/sonner';
import { fetchGeofences, setNotConsidered } from '@/lib/api';

/** The most rows shown at once: HCSS's Location list holds thousands of codes, so Dave searches. */
const SHOWN = 100;

/**
 * Geofences in Settings: every geofence code the app knows (HCSS's Location
 * list, and every code an Import brought), by code, with a search box. Each
 * code's switch is on while it is considered; turned off, it is Not
 * considered: its visits are skipped on every Truck and every day, past days
 * included. Codes come only from HCSS and Imports, so there is no Add.
 */
export function GeofencesSection() {
  const [geofences, setGeofences] = useState<Geofence[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetchGeofences().then(setGeofences, () => setFailed(true));
  }, []);

  const put = (code: string, notConsidered: boolean) =>
    setGeofences((current) => current && current.map((g) => (g.code === code ? { ...g, notConsidered } : g)));

  /** The switch moves at once; if the save fails it goes back and Dave is told. */
  async function toggle(geofence: Geofence, considered: boolean) {
    put(geofence.code, !considered);
    try {
      await setNotConsidered(geofence.code, !considered);
    } catch {
      put(geofence.code, geofence.notConsidered);
      toast.error(`Could not save ${geofence.code}`);
    }
  }

  const term = search.trim().toLowerCase();
  const matching = geofences?.filter((g) => g.code.toLowerCase().includes(term)) ?? [];
  const shown = matching.slice(0, SHOWN);
  const off = geofences?.filter((g) => g.notConsidered).length ?? 0;
  return (
    <section aria-labelledby="section-geofences" className="animate-rise space-y-3 rounded-lg border border-border/80 bg-background p-4 shadow-sm">
      <div>
        <h2 id="section-geofences" className="font-display text-xl font-semibold uppercase tracking-wide">
          Geofences
        </h2>
        <p className="text-xs text-muted-foreground">
          Turn off a code that is never work, such as a fuel stop or a road fence: it is Not considered, and its visits are skipped on every Truck and every day, past days included.
          {geofences && ` ${geofences.length} ${geofences.length === 1 ? 'code' : 'codes'}, ${off} not considered.`}
        </p>
      </div>
      {failed && <p className="text-sm text-destructive">Could not load the geofences. Reload the page to try again.</p>}
      {!geofences && !failed && (
        <p>
          <Loading what="Geofences" />
        </p>
      )}
      {geofences && (
        <>
          <Input type="search" aria-label="Search geofences" placeholder="Search, e.g. gas" value={search} onChange={(e) => setSearch(e.target.value)} className="h-11" />
          {geofences.length === 0 && <EmptyBox>No geofence codes yet. An Import adds the codes it brings.</EmptyBox>}
          {geofences.length > 0 && matching.length === 0 && <EmptyBox>No geofence code holds “{search.trim()}”.</EmptyBox>}
          {shown.length > 0 && (
            <ul aria-label="Geofences" className="divide-y">
              {shown.map((g) => (
                <li key={g.code} className="flex min-h-11 items-center justify-between gap-3 py-1">
                  <span className={g.notConsidered ? 'text-muted-foreground line-through' : undefined}>{g.code}</span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    {g.notConsidered ? 'Not considered' : 'Considered'}
                    <Switch aria-label={`Consider ${g.code}`} checked={!g.notConsidered} onCheckedChange={(on) => toggle(g, on)} />
                  </span>
                </li>
              ))}
            </ul>
          )}
          {matching.length > shown.length && (
            <p className="text-xs text-muted-foreground">
              {shown.length} of {matching.length} shown. Type more to narrow the list.
            </p>
          )}
        </>
      )}
    </section>
  );
}
