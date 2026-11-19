import { ClipboardList } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ListName } from '../../shared/types';
import { ListTab, type ListTabSpec } from '@/components/ListTab';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

/** Keeps each tab's field keys checked against its own list. */
const tab = <L extends ListName>(spec: ListTabSpec<L>) => spec as unknown as ListTabSpec<ListName>;

/** One tab per list, in this order. A new list is one more entry here. */
const TABS = [
  tab({
    list: 'drivers',
    title: 'Drivers',
    noun: 'Driver',
    name: { key: 'name', label: 'Name' },
    fields: [{ key: 'defaultTruckId', label: 'Usual Truck', kind: 'pick', list: 'trucks', empty: 'No usual Truck' }],
  }),
  tab({
    list: 'trucks',
    title: 'Trucks',
    noun: 'Truck',
    name: { key: 'number', label: 'Number' },
    fields: [
      { key: 'hcssCode', label: 'HCSS code', kind: 'text' },
      { key: 'hcssGuid', label: 'HCSS id', kind: 'text' },
    ],
  }),
];

/** Settings: the lists the Board picks from, one tab each. */
export function SettingsPage() {
  return (
    <div className="min-h-screen bg-surface">
      <PageHeader title="Settings" subtitle="The lists the Dispatch board picks from">
        <Button asChild variant="outline" size="lg" className="px-5">
          <Link to="/">
            <ClipboardList className="h-4 w-4" /> Board
          </Link>
        </Button>
      </PageHeader>
      <main className="container py-6">
        <Tabs defaultValue={TABS[0].list}>
          <TabsList>
            {TABS.map((spec) => (
              <TabsTrigger key={spec.list} value={spec.list}>
                {spec.title}
              </TabsTrigger>
            ))}
          </TabsList>
          {TABS.map((spec) => (
            <TabsContent key={spec.list} value={spec.list}>
              <ListTab spec={spec} />
            </TabsContent>
          ))}
        </Tabs>
      </main>
    </div>
  );
}
