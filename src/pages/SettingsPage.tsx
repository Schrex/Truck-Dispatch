import { ClipboardList } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';

/** Settings: the lists the Board picks from. Empty until the lists land. */
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
        <p className="rounded-lg border border-dashed bg-background py-16 text-center text-sm text-muted-foreground">Nothing to set up yet.</p>
      </main>
    </div>
  );
}
