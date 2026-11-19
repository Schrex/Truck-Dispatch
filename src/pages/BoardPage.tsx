import { useEffect, useState } from 'react';
import { CalendarDays, ClipboardList, Loader2, Settings } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Driver, Order } from '../../shared/types';
import { NewOrderDialog } from '@/components/NewOrderDialog';
import { OrderCard } from '@/components/OrderCard';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { fetchDrivers, fetchOrders } from '@/lib/api';
import { formatDate, today } from '@/lib/dates';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The daily dispatch board: one day's orders, "Jump to" another day, and "New Order". */
export function BoardPage() {
  // The day on the board is kept in the address, so a reload or a shared link shows the same day.
  const [search, setSearch] = useSearchParams();
  const [date, setDate] = useState(() => {
    const fromUrl = search.get('date');
    return fromUrl && DATE.test(fromUrl) ? fromUrl : today();
  });
  const [drivers, setDrivers] = useState<Driver[] | null>(null);
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetchDrivers().then(setDrivers, () => setDrivers([]));
  }, []);

  useEffect(() => {
    if (DATE.test(date)) setSearch({ date }, { replace: true });
  }, [date, setSearch]);

  useEffect(() => {
    if (!DATE.test(date)) return;
    let stale = false;
    setOrders(null);
    setFailed(false);
    fetchOrders(date).then(
      (list) => !stale && setOrders(list),
      () => !stale && setFailed(true),
    );
    return () => {
      stale = true;
    };
  }, [date]);

  const added = (order: Order) => {
    if (order.workDate === date) {
      fetchOrders(date).then(setOrders, () => setFailed(true));
    } else {
      setDate(order.workDate);
    }
  };

  return (
    <div className="min-h-screen bg-surface">
      <PageHeader title="Dispatch" subtitle="Daily truck dispatch board">
        <div className="space-y-1.5">
          <label htmlFor="jump-to" className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <CalendarDays className="h-3.5 w-3.5" /> Jump to
          </label>
          <Input id="jump-to" type="date" className="h-11 w-48" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </div>
        <Button asChild variant="outline" size="lg" className="px-5">
          <Link to="/settings">
            <Settings className="h-4 w-4" /> Settings
          </Link>
        </Button>
        <NewOrderDialog date={date} drivers={drivers} onCreated={added} />
      </PageHeader>

      <main className="container space-y-4 py-6">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-lg font-semibold uppercase tracking-wide">{DATE.test(date) ? formatDate(date) : ''}</h2>
          {orders && orders.length > 0 && (
            <span className="text-sm text-muted-foreground">
              {orders.length} order{orders.length === 1 ? '' : 's'}
            </span>
          )}
        </div>

        {failed && <p className="text-sm text-destructive">Could not load orders.</p>}
        {!orders && !failed && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading orders…
          </p>
        )}
        {orders?.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed bg-background py-16 text-center">
            <ClipboardList className="h-8 w-8 text-muted-foreground" />
            <p className="font-medium">No orders for this day</p>
            <p className="text-sm text-muted-foreground">Use New Order to add work and assign a driver.</p>
          </div>
        )}
        {orders && orders.length > 0 && (
          <div className="grid gap-3 md:grid-cols-2">
            {orders.map((order) => (
              <OrderCard key={order.id} order={order} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
