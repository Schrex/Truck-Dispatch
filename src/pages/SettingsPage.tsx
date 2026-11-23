import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, ClipboardList } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ORDERED_LISTS, type ListName, type OrderedList } from '../../shared/types';
import { EntryPanel } from '@/components/settings/EntryPanel';
import { ListSection } from '@/components/settings/ListSection';
import { TruckProblemsSection } from '@/components/settings/TruckProblemsSection';
import { section, type NameOf, type Row, type SectionSpec } from '@/components/settings/spec';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { changeEntry, fetchLaterDays, fetchList, reorderList } from '@/lib/api';
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
    // Its HCSS code and id stay in the database for counting Trips later; they come from HCSS, so Settings neither shows nor asks for them.
    fields: [],
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
      {
        key: 'usualForemanId',
        label: 'Usual Foreman',
        kind: 'pick',
        list: 'foremen',
        empty: 'No usual Foreman',
        // Only a job site has one; the Worker empties it when the Place stops being one.
        shownWhen: (form) => form.kind === 'job_site',
      },
    ],
    // Its kind, and a job site's usual Foreman after it, as in "TIUNY · Job site · Brody".
    detail: (place, nameOf) => [place.kind && PLACE_KIND_LABELS[place.kind], nameOf('foremen', place.usualForemanId)].filter(Boolean).join(' · ') || null,
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
  section({
    list: 'inspection-items',
    title: 'Inspection checklist',
    noun: 'Inspection item',
    name: { key: 'label', label: 'Item' },
    fields: [{ key: 'optional', label: 'Optional', kind: 'switch', hint: 'A Driver may finish his Inspection without answering it.' }],
    detail: (item) => (item.optional ? 'Optional' : null),
    renamed: 'new wording is used from the next Inspection on.',
  }),
];

/** Whether Dave puts this list in his own order with ▲▼. */
const isOrdered = (list: ListName): list is OrderedList => (ORDERED_LISTS as readonly ListName[]).includes(list);

/** The panel open now: an entry of a list, or a new one (entry null). */
type Open = { list: ListName; entry: Row | null } | null;

/** Settings: every list the Board picks from, on one page, each entry a chip that opens an edit panel; and, under Trucks, the Truck problems. */
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

  /**
   * Puts a saved entry back in its place in the list, or last if it is new or,
   * in an ordered list, brought back: the Worker puts those last.
   */
  const put = (list: ListName, saved: Row) =>
    setLists((current) => {
      const rows = current[list] ?? [];
      const at = rows.findIndex((e) => e.id === saved.id);
      const broughtBack = at !== -1 && !rows[at].active && saved.active && isOrdered(list);
      if (at === -1 || broughtBack) return { ...current, [list]: [...rows.filter((e) => e.id !== saved.id), saved] };
      return { ...current, [list]: rows.map((e, i) => (i === at ? saved : e)) };
    });

  /**
   * Moves an entry in use one place up (-1) or down (1) and saves the whole
   * order of the entries in use. The chips move at once; if the save fails
   * they go back and Dave is told.
   */
  async function move(spec: SectionSpec<ListName>, list: OrderedList, inUse: Row[], index: number, by: -1 | 1) {
    const order = [...inUse];
    [order[index], order[index + by]] = [order[index + by], order[index]];
    const before = lists[list];
    setLists((current) => ({ ...current, [list]: [...order, ...(current[list] ?? []).filter((e) => !e.active)] }));
    try {
      await reorderList(list, order.map((e) => e.id));
    } catch {
      setLists((current) => ({ ...current, [list]: before }));
      toast.error(`Could not move ${String(inUse[index][spec.name.key])}`);
    }
  }

  /** ▲ and ▼ after a chip in use in an ordered list, each left out where it could not move. */
  const moveButtons = (spec: SectionSpec<ListName>) => {
    const list = spec.list;
    if (!isOrdered(list)) return undefined;
    return (entry: Row, index: number, inUse: Row[]) => {
      const name = String(entry[spec.name.key]);
      const button = (by: -1 | 1) => (
        <Button
          variant="ghost"
          size="sm"
          className="h-11 w-11 rounded-full p-0 text-muted-foreground shadow-none hover:bg-background hover:text-foreground"
          aria-label={`Move ${name} ${by < 0 ? 'up' : 'down'}`}
          title={by < 0 ? 'Earlier in the list' : 'Later in the list'}
          onClick={() => move(spec, list, inUse, index, by)}
        >
          {by < 0 ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
      );
      if (inUse.length < 2) return null;
      return (
        <span className="flex items-center border-l border-border/70 pr-1">
          {index > 0 && button(-1)}
          {index < inUse.length - 1 && button(1)}
        </span>
      );
    };
  };

  const nameOf: NameOf = (list, id) => {
    const entry = lists[list]?.find((e) => e.id === id);
    return entry ? displayName(list, entry as never) : null;
  };

  const openSpec = open && SECTIONS.find((s) => s.list === open.list);
  return (
    <div className="min-h-screen bg-surface">
      <PageHeader title="Settings" subtitle="The lists the board picks from">
        <Button asChild variant="outline" size="lg" className="px-5">
          <Link to="/">
            <ClipboardList className="h-4 w-4" /> Board
          </Link>
        </Button>
      </PageHeader>
      <main className="container grid gap-4 py-6 lg:grid-cols-2">
        {SECTIONS.map((spec) => (
          // Truck problems shares the Trucks cell, so on two columns it sits right under Trucks.
          <div key={spec.list} className="flex flex-col gap-4">
          <ListSection
            spec={spec}
            entries={lists[spec.list] ?? null}
            failed={unloaded.includes(spec.list)}
            nameOf={nameOf}
            onOpen={(entry) => setOpen({ list: spec.list, entry })}
            onAdd={() => setOpen({ list: spec.list, entry: null })}
            chipControls={moveButtons(spec)}
          />
          {/* Under Trucks: what Drivers reported wrong with them, for Dave to mark fixed. */}
          {spec.list === 'trucks' && <TruckProblemsSection />}
          </div>
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
