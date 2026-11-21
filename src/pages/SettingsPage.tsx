import { useEffect, useState } from 'react';
import { ClipboardList } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ListName } from '../../shared/types';
import { EntryPanel } from '@/components/settings/EntryPanel';
import { ListSection } from '@/components/settings/ListSection';
import { section, type NameOf, type Row, type SectionSpec } from '@/components/settings/spec';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { changeEntry, fetchLaterDays, fetchList } from '@/lib/api';
import { displayName, PLACE_KIND_CHOICES, PLACE_KIND_LABELS } from '@/lib/lists';

/** One section per list, in this order. A new list or field is a change here. */
const SECTIONS: SectionSpec<ListName>[] = [
  section({
    list: 'drivers',
    title: 'Drivers',
    noun: 'Driver',
    name: { key: 'name', label: 'Name' },
    fields: [{ key: 'defaultTruckId', label: 'Usual Truck', kind: 'pick', list: 'trucks', empty: 'No usual Truck' }],
    detail: (driver, nameOf) => {
      const truck = nameOf('trucks', driver.defaultTruckId);
      return truck && `Truck ${truck}`;
    },
    removeWarning: async (driver) => {
      const days = await fetchLaterDays(driver.id);
      return days > 0 ? `${driver.name} has Assignments on ${days} later ${days === 1 ? 'day' : 'days'}.` : null;
    },
  }),
  section({
    list: 'trucks',
    title: 'Trucks',
    noun: 'Truck',
    name: { key: 'number', label: 'Number' },
    fields: [
      { key: 'hcssCode', label: 'HCSS code', kind: 'text' },
      { key: 'hcssGuid', label: 'HCSS id', kind: 'text' },
    ],
    detail: (truck) => hcssLink(truck),
    status: (truck) => hcssLink(truck),
  }),
  section({
    list: 'places',
    title: 'Places',
    noun: 'Place',
    name: { key: 'shortName', label: 'Short name' },
    // The geofence code is not part of the API: it comes from HCSS for GPS matching later.
    fields: [
      { key: 'fullName', label: 'Full name', kind: 'text' },
      {
        key: 'kind',
        label: 'Kind',
        kind: 'choice',
        empty: 'No kind',
        choices: PLACE_KIND_CHOICES.map((value) => ({ value, label: PLACE_KIND_LABELS[value] })),
        shownAs: { yard: 'shop' },
      },
      { key: 'jobId', label: 'Job', kind: 'pick', list: 'jobs', empty: 'No Job' },
    ],
    detail: (place) => place.kind && PLACE_KIND_LABELS[place.kind],
    status: (place) => (place.onTruckMap ? 'On the truck map' : 'Not on the truck map yet'),
  }),
  section({ list: 'materials', title: 'Materials', noun: 'Material', name: { key: 'name', label: 'Name' }, fields: [] }),
  section({
    list: 'jobs',
    title: 'Jobs',
    noun: 'Job',
    name: { key: 'name', label: 'Name' },
    fields: [{ key: 'jobNumber', label: 'Job number', kind: 'text' }],
    detail: (job) => job.jobNumber,
  }),
  section({ list: 'foremen', title: 'Foremen', noun: 'Foreman', name: { key: 'name', label: 'Name' }, fields: [] }),
];

/** Whether a Truck has its HCSS id, so its Trips can be counted later. */
const hcssLink = (truck: { hcssGuid: string | null }) => (truck.hcssGuid ? 'Linked to HCSS Fleet' : 'Not linked yet');

/** The panel open now: an entry of a list, or a new one (entry null). */
type Open = { list: ListName; entry: Row | null } | null;

/** Settings: every list the Board picks from, on one page, each entry a chip that opens an edit panel. */
export function SettingsPage() {
  const [lists, setLists] = useState<Partial<Record<ListName, Row[]>>>({});
  const [unloaded, setUnloaded] = useState<ListName[]>([]);
  const [open, setOpen] = useState<Open>(null);

  useEffect(() => {
    for (const { list } of SECTIONS) {
      fetchList(list, { includeInactive: true }).then(
        (rows) => setLists((current) => ({ ...current, [list]: rows as unknown as Row[] })),
        () => setUnloaded((current) => [...current, list]),
      );
    }
  }, []);

  /** Puts a saved entry back in its place in the list, or last if it is new. */
  const put = (list: ListName, saved: Row) =>
    setLists((current) => {
      const rows = current[list] ?? [];
      const at = rows.findIndex((e) => e.id === saved.id);
      return { ...current, [list]: at === -1 ? [...rows, saved] : rows.map((e, i) => (i === at ? saved : e)) };
    });

  const nameOf: NameOf = (list, id) => {
    const entry = lists[list]?.find((e) => e.id === id);
    return entry ? displayName(list, entry as never) : null;
  };

  async function bringBack(spec: SectionSpec<ListName>, entry: Row) {
    try {
      put(spec.list, (await changeEntry(spec.list, entry.id, { active: true } as never)) as unknown as Row);
    } catch {
      toast.error(`Could not bring back ${String(entry[spec.name.key])}`);
    }
  }

  const openSpec = open && SECTIONS.find((s) => s.list === open.list);
  return (
    <div className="min-h-screen bg-surface">
      <PageHeader title="Settings" subtitle="The lists the Dispatch board picks from">
        <Button asChild variant="outline" size="lg" className="px-5">
          <Link to="/">
            <ClipboardList className="h-4 w-4" /> Board
          </Link>
        </Button>
      </PageHeader>
      <main className="container grid gap-4 py-6 lg:grid-cols-2">
        {SECTIONS.map((spec) => (
          <ListSection
            key={spec.list}
            spec={spec}
            entries={lists[spec.list] ?? null}
            failed={unloaded.includes(spec.list)}
            nameOf={nameOf}
            onOpen={(entry) => setOpen({ list: spec.list, entry })}
            onAdd={() => setOpen({ list: spec.list, entry: null })}
            onBringBack={(entry) => bringBack(spec, entry)}
          />
        ))}
      </main>
      {open && openSpec && (
        <EntryPanel
          key={`${open.list}/${open.entry?.id ?? 'new'}`}
          spec={openSpec}
          entry={open.entry}
          others={lists}
          unloaded={unloaded}
          onSaved={(saved) => put(open.list, saved)}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}
